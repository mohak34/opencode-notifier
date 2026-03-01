import { spawn } from "child_process"
import type { EventType, NotifierConfig } from "./config"

function substituteTokens(value: string, event: EventType, message: string, sessionTitle?: string | null, projectName?: string | null, timestamp?: string | null, turn?: number | null): string {
  let result = value.replaceAll("{event}", event).replaceAll("{message}", message)
  result = result.replaceAll("{sessionTitle}", sessionTitle || "")
  result = result.replaceAll("{projectName}", projectName || "")
  result = result.replaceAll("{timestamp}", timestamp || "")
  result = result.replaceAll("{turn}", turn != null ? String(turn) : "")
  return result
}

export function runCommand(config: NotifierConfig, event: EventType, message: string, sessionTitle?: string | null, projectName?: string | null, timestamp?: string | null, turn?: number | null): void {
  if (!config.command.enabled || !config.command.path) {
    return
  }

  const args = (config.command.args ?? []).map((arg) => substituteTokens(arg, event, message, sessionTitle, projectName, timestamp, turn))
  const command = substituteTokens(config.command.path, event, message, sessionTitle, projectName, timestamp, turn)

  const proc = spawn(command, args, {
    stdio: "ignore",
    detached: true,
  })

  proc.on("error", () => {})
  proc.unref()
}
