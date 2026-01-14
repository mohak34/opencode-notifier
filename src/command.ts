import { spawn } from "child_process"
import type { EventType, NotifierConfig } from "./config"

function substituteTokens(value: string, event: EventType, message: string): string {
  return value.replaceAll("{event}", event).replaceAll("{message}", message)
}

export function runCommand(config: NotifierConfig, event: EventType, message: string): void {
  if (!config.command.enabled || !config.command.path) {
    return
  }

  const args = (config.command.args ?? []).map((arg) => substituteTokens(arg, event, message))
  const command = substituteTokens(config.command.path, event, message)

  const proc = spawn(command, args, {
    stdio: "ignore",
    detached: true,
  })

  proc.on("error", (error) => {
    console.error(`[opencode-notifier] Failed to execute command: ${error.message}`)
    console.error(`[opencode-notifier] Command: ${command} ${args.join(" ")}`)
  })

  proc.unref()
}
