import { createHash } from "crypto"
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const MARKER_TTL_MS = 60 * 60_000
let lastPrune = 0

// Several V2 terminals on one machine can show the same session. Each one claims an event before
// delivering it by creating a marker file named after the event; only the first create succeeds.
// Any other failure fails open, so a broken temp directory never mutes alerts.
export function claimDelivery(key: string, now = Date.now()): boolean {
  const dir = join(tmpdir(), `opencode-notifier-${process.getuid?.() ?? "claims"}`)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (now - lastPrune > MARKER_TTL_MS / 6) {
      lastPrune = now
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        try {
          if (now - statSync(path).mtimeMs > MARKER_TTL_MS) unlinkSync(path)
        } catch {}
      }
    }
    writeFileSync(join(dir, createHash("sha256").update(key).digest("hex")), "", { flag: "wx" })
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "EEXIST"
  }
}
