import { accessSync, chmodSync, constants } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const PACKAGE = "node-notifier"
const VENDOR_DIR = join("vendor", "snoreToast")

function debug(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) {
    console.error(`[opencode-notifier] ${message}`)
  }
}

/**
 * The snoreToast executable node-notifier uses for this architecture, or null
 * when the package cannot be resolved (for example from a bundled layout).
 */
export function snoreToastPath(arch: string = process.arch): string | null {
  try {
    const require = createRequire(import.meta.url)
    const packageRoot = dirname(require.resolve(PACKAGE))
    const binary = `snoretoast-x${arch === "x64" ? "64" : "86"}.exe`
    return join(packageRoot, VENDOR_DIR, binary)
  } catch {
    return null
  }
}

/** True when the file exists and carries an execute bit. */
export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Adds +x when needed. Returns true when the file is executable afterwards. */
export function makeExecutable(path: string): boolean {
  if (isExecutable(path)) {
    return true
  }
  try {
    chmodSync(path, 0o755)
  } catch (error) {
    // A read-only install cannot be repaired here; the caller keeps today's behavior.
    debug(`snoreToast: chmod failed for ${path}: ${String(error)}`)
    return false
  }
  debug(`snoreToast: restored +x on ${path}`)
  return isExecutable(path)
}

/**
 * npm publishes node-notifier with its snoreToast executables at 0644 even
 * though the repository stores them 0755. WSL still enforces the Unix execute
 * bit for Windows binaries, so every toast spawn fails with EACCES inside
 * node-notifier, which reports no error to the plugin. Restore the bit once at
 * load so a fresh install delivers notifications without a manual chmod.
 *
 * Never throws: a read-only install keeps today's behavior.
 */
export function ensureSnoreToastExecutable(arch: string = process.arch): boolean {
  const path = snoreToastPath(arch)
  return path ? makeExecutable(path) : false
}
