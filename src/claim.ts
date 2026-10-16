import { createHash } from "crypto"
import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "fs"
import type { Stats } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const MARKER_TTL_MS = 60 * 60_000
const MARKER_NAME = /^[a-f0-9]{64}$/

function debug(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) console.error(`[opencode-notifier] claim: ${message}`)
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "unsafe storage"
}

function isMarker(info: Stats, uid: number | undefined): boolean {
  return info.isFile() && !info.isSymbolicLink() && info.size === 0 && info.nlink === 1 &&
    (uid === undefined || info.uid === uid)
}

function ensureDirectory(directory: string): void {
  try {
    mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  // Check only our direct directory: the system temp path may itself be a symlink.
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Symlinked claim directory")
}

// V2 terminals sharing a temp directory deduplicate alerts by exclusively creating a marker
// for each event. true permits delivery; false means another terminal claimed it.
// Unsafe or unavailable storage permits delivery rather than risking a missed alert.
// Tests can supply a throwaway temp root; each instance tracks its own cleanup interval.
export function createDeliveryClaimer(tempDirectory?: string) {
  let lastPrune = 0
  return function claimDelivery(key: string, now = Date.now()): boolean {
    try {
      const uid = process.getuid?.()
      const dir = join(tempDirectory ?? tmpdir(), `opencode-notifier-${uid ?? "claims"}`)
      ensureDirectory(dir)

      if (now - lastPrune > MARKER_TTL_MS / 6) {
        lastPrune = now
        for (const name of readdirSync(dir)) {
          if (!MARKER_NAME.test(name)) continue
          const path = join(dir, name)
          try {
            const info = lstatSync(path)
            if (isMarker(info, uid) && now - info.mtimeMs > MARKER_TTL_MS) unlinkSync(path)
          } catch (error) {
            debug(`skipping marker cleanup (${errorCode(error)})`)
          }
        }
      }

      try {
        writeFileSync(join(dir, createHash("sha256").update(key).digest("hex")), "", { flag: "wx", mode: 0o600 })
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          debug(`marker creation failed (${errorCode(error)}); delivering`)
          return true
        }
        try {
          if (isMarker(lstatSync(join(dir, createHash("sha256").update(key).digest("hex"))), uid)) return false
        } catch {}
        debug("existing marker is unsafe; delivering")
        return true
      }
    } catch (error) {
      // Unsafe or unavailable storage disables deduplication, never notifications.
      debug(`storage unavailable (${errorCode(error)}); delivering`)
      return true
    }
  }
}

export const claimDelivery = createDeliveryClaimer()
