import { spawn } from "child_process"
import type { EventType, NotifierConfig } from "./config"

function substituteTokens(value: string, event: EventType, message: string, sessionTitle?: string | null): string {
  let result = value.replaceAll("{event}", event).replaceAll("{message}", message)
  result = result.replaceAll("{sessionTitle}", sessionTitle || "")
  return result
}

export function runCommand(config: NotifierConfig, event: EventType, message: string, sessionTitle?: string | null): void {
  if (!config.command.enabled || !config.command.path) {
    return
  }

  const args = (config.command.args ?? []).map((arg) => substituteTokens(arg, event, message, sessionTitle))
  const command = substituteTokens(config.command.path, event, message, sessionTitle)

  const proc = spawn(command, args, {
    stdio: "ignore",
    detached: true,
  })

  proc.on("error", () => {})
  proc.unref()
}
