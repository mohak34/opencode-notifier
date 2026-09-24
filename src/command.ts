import { spawn } from "child_process"
import type { EventType, NotifierConfig } from "./config"

function substituteTokens(value: string, event: EventType, message: string, sessionTitle?: string | null, agentName?: string | null, projectName?: string | null, timestamp?: string | null, turn?: number | null): string {
  let result = value.replaceAll("{event}", event).replaceAll("{message}", message)
  result = result.replaceAll("{sessionTitle}", sessionTitle || "")
  result = result.replaceAll("{agentName}", agentName || "")
  result = result.replaceAll("{projectName}", projectName || "")
  result = result.replaceAll("{timestamp}", timestamp || "")
  result = result.replaceAll("{turn}", turn != null ? String(turn) : "")
  return result
}

export function runCommand(config: NotifierConfig, event: EventType, message: string, sessionTitle?: string | null, agentName?: string | null, projectName?: string | null, timestamp?: string | null, turn?: number | null): void {
  if (!config.command.enabled || !config.command.path) {
    return
  }

  const args = (config.command.args ?? []).map((arg) => substituteTokens(arg, event, message, sessionTitle, agentName, projectName, timestamp, turn))
  const command = substituteTokens(config.command.path, event, message, sessionTitle, agentName, projectName, timestamp, turn)

  // Fire-and-forget: a notifier must never take down the host, so a
  // synchronous spawn throw (bad path, EACCES, ...) is swallowed here.
  // Async failures are already ignored via the error handler below.
  let proc: ReturnType<typeof spawn>
  try {
    proc = spawn(command, args, {
      // Keep token values as argv data. Interpreter commands must pass them to
      // their script as separate arguments instead of embedding them in source.
      shell: false,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    })
  } catch {
    return
  }

  proc.on("error", () => {})
  proc.unref()
}
