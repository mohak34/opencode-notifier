import { createHash } from "crypto"
import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const MARKER_TTL_MS = 60 * 60_000
const MARKER_NAME = /^[a-f0-9]{64}$/

// Logging must never turn a fail-open path into a dropped alert.
function debug(message: string): void {
  try {
    if (process.env.OPENCODE_NOTIFIER_DEBUG) console.error(`[opencode-notifier] claim: ${message}`)
  } catch {}
}

// The directory V2 terminals share for event claims and open-session presence. It must be a real
// directory we own that no one else can write; otherwise another user could swap it for a symlink
// and steer our cleanup into unrelated files. undefined means unsafe or unavailable: callers skip
// coordination and deliver. The temp root itself is trusted.
export function sharedDirectory(tempRoot?: string): string | undefined {
  try {
    const uid = process.getuid?.()
    const dir = join(tempRoot ?? tmpdir(), `opencode-notifier-${uid ?? "claims"}`)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const info = lstatSync(dir)
    if (info.isDirectory() && (uid === undefined || (info.uid === uid && (info.mode & 0o022) === 0))) return dir
    debug("shared directory is not a private directory we own; delivering")
  } catch (error) {
    debug(`shared directory unavailable (${(error as NodeJS.ErrnoException).code ?? "unknown"}); delivering`)
  }
}

// V2 terminals deduplicate alerts by exclusively creating a marker for each event.
// true permits delivery; false means another terminal claimed it.
// Tests can supply a throwaway temp root; each instance tracks its own cleanup interval.
export function createDeliveryClaimer(tempRoot?: string) {
  let lastPrune = 0
  return function claimDelivery(key: string, now = Date.now()): boolean {
    try {
      const dir = sharedDirectory(tempRoot)
      if (!dir) return true

      if (now - lastPrune > MARKER_TTL_MS / 6) {
        lastPrune = now
        for (const name of readdirSync(dir)) {
          if (!MARKER_NAME.test(name)) continue
          const path = join(dir, name)
          try {
            if (now - lstatSync(path).mtimeMs > MARKER_TTL_MS) unlinkSync(path)
          } catch {}
        }
      }

      try {
        writeFileSync(join(dir, createHash("sha256").update(key).digest("hex")), "", { flag: "wx", mode: 0o600 })
      } catch (error) {
        // Only an existing marker means another terminal claimed the event.
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
        throw error
      }
      return true
    } catch (error) {
      debug(`marker unavailable (${(error as NodeJS.ErrnoException).code ?? "unknown"}); delivering`)
      return true
    }
  }
}

export const claimDelivery = createDeliveryClaimer()
