import { chmodSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

function debug(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) console.error(`[opencode-notifier] snoreToast: ${message}`)
}

/**
 * Called once at load on WSL. npm publishes node-notifier's snoreToast binaries
 * without +x, WSL needs it to launch them, and node-notifier swallows the
 * EACCES, so toasts fail silently. Adds +x like a manual `chmod +x` would.
 * The x64/x86 pick mirrors node-notifier's notifiers/toaster.js. Never throws.
 */
export function ensureSnoreToastExecutable(): void {
  try {
    const root = dirname(createRequire(import.meta.url).resolve("node-notifier"))
    const path = join(root, "vendor", "snoreToast", `snoretoast-x${process.arch === "x64" ? "64" : "86"}.exe`)
    const { mode } = statSync(path)
    if (mode & 0o100) return
    chmodSync(path, mode | 0o111)
    debug(`restored +x on ${path}`)
  } catch (error) {
    debug(`could not restore +x: ${String(error)}`)
  }
}
