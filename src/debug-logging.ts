import { appendFileSync } from "node:fs"
import { join } from "node:path"

const DEBUG = process.env.OPENCODE_NOTIFIER_DEBUG === "true"
const LOG_FILE = join(process.cwd(), ".opencode_notifier_logs.jsonl")

export function logEvent(data: unknown): void {
  if (!DEBUG) return
  
  try {
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...(data as Record<string, unknown>),
    })
    appendFileSync(LOG_FILE, `${logEntry}\n`)
  } catch {
    // Silently fail if logging fails
  }
}

export function isDebugEnabled(): boolean {
  return DEBUG
}
