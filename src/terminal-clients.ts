import { randomUUID } from "crypto"
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { claimDelivery } from "./claim"
import { debugFocusState as debug } from "./focus"

export interface TerminalState {
  location: { directory: string; workspaceID?: string }
  // null means the host does not expose client-local session state.
  sessions: readonly string[] | null
}

const HEARTBEAT_MS = 1000
const STALE_MS = 5000
const FALLBACK_GRACE_MS = 150

async function bounded<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 500) })])
  } catch { return fallback }
  finally { clearTimeout(timer) }
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" }
}

// Presence is separate from the event claim: a slower client with this session
// open must be preferred before a faster, unrelated client wins the claim.
export function createTerminalClients(getState: () => TerminalState, rootSession: (sessionID: string) => string = id => id) {
  const directory = join(tmpdir(), `opencode-notifier-${process.getuid?.() ?? "claims"}`, "clients")
  const path = join(directory, `${randomUUID()}.json`)
  let disposed = false
  let state: TerminalState | undefined
  let writing: Promise<void> | undefined

  async function refresh(): Promise<void> {
    if (disposed) return
    try { state = getState() } catch { return }
    if (writing) return bounded(writing, undefined)
    const snapshot = state
    writing = (async () => {
      const temporary = path + ".tmp"
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await writeFile(temporary, JSON.stringify({
          pid: process.pid, updated: Date.now(), location: snapshot.location,
          sessions: snapshot.sessions?.slice(0, 2048) ?? null,
        }), { mode: 0o600 })
        if (!disposed) await rename(temporary, path)
        else await unlink(temporary)
        // Disposal can race the asynchronous rename.
        if (disposed) await unlink(path).catch(() => {})
      } catch { await unlink(temporary).catch(() => {}) }
    })().finally(() => { writing = undefined })
    await bounded(writing, undefined)
  }

  async function anotherOwner(sessionID: string, root: string): Promise<boolean> {
    const current = state
    if (!current) return false
    return bounded((async () => {
      const names = (await readdir(directory)).filter(name => /^[\da-f-]{36}\.json$/.test(name)).slice(0, 256)
      const matches = await Promise.all(names.map(async name => {
        const candidate = join(directory, name)
        if (candidate === path) return false
        try {
          const raw = await readFile(candidate, "utf8")
          if (raw.length > 256_000) return false
          const peer = JSON.parse(raw)
          if (typeof peer.updated !== "number" || Date.now() - peer.updated > STALE_MS || peer.updated > Date.now() + STALE_MS || !alive(peer.pid)) {
            await unlink(candidate).catch(() => {})
            return false
          }
          return peer.location?.directory === current.location.directory
            && peer.location?.workspaceID === current.location.workspaceID
            && Array.isArray(peer.sessions) && (peer.sessions.includes(sessionID) || peer.sessions.includes(root))
        } catch { return false }
      }))
      return matches.some(Boolean)
    })(), false)
  }

  const heartbeat = setInterval(() => void refresh(), HEARTBEAT_MS)
  heartbeat.unref()
  return {
    refresh,
    async claim(key: string, sessionID: string | null): Promise<boolean> {
      await refresh()
      if (disposed) return false
      if (!sessionID) return claimDelivery(key)
      let root = sessionID
      try { root = rootSession(sessionID) || sessionID } catch {}
      const own = state?.sessions
      if (own?.includes(sessionID) || own?.includes(root)) return claimDelivery(key)
      if (await anotherOwner(sessionID, root)) {
        debug(`v2 session ${sessionID}: another terminal has its session open, skipping local delivery`)
        return false
      }
      // Give clients finishing setup a chance to publish their open sessions.
      // Missing UI APIs keep the legacy fail-open claim path.
      if (own) {
        await new Promise(resolve => setTimeout(resolve, FALLBACK_GRACE_MS))
        if (await anotherOwner(sessionID, root)) return false
      }
      return !disposed && claimDelivery(key)
    },
    dispose() {
      disposed = true
      clearInterval(heartbeat)
      void unlink(path).catch(() => {})
    },
  }
}
