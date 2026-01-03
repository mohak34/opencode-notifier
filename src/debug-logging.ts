import { appendFileSync } from "fs"
import { join } from "path"

const DEBUG = process.env.OPENCODE_NOTIFIER_DEBUG === "true"
const LOG_FILE = join(process.cwd(), ".opencode_notifier_logs.jsonl")

export function logEvent(data: unknown): void {
  if (!DEBUG) return
  
  try {
    appendFileSync(LOG_FILE, JSON.stringify({
      timestamp: new Date().toISOString(),
      ...data as Record<string, unknown>
    }) + "\n")
  } catch {
    // Silently fail if logging fails
  }
}

export function isDebugEnabled(): boolean {
  return DEBUG
}
