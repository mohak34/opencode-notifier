import { readFileSync, existsSync, appendFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const DEBUG = process.env.OPENCODE_NOTIFIER_DEBUG === "true"
const LOG_FILE = join(process.cwd(), ".opencode_notifier_logs.jsonl")

function logConfigEvent(data: any): void {
  if (!DEBUG) return
  try {
    appendFileSync(LOG_FILE, JSON.stringify({
      timestamp: new Date().toISOString(),
      action: "loadConfig",
      ...data
    }) + "\n")
  } catch {
    // Silently fail if logging fails
  }
}

export type EventType = "permission" | "complete" | "error"

export interface EventConfig {
  sound: boolean
  notification: boolean
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  timeout: number
  events: {
    permission: EventConfig
    complete: EventConfig
    error: EventConfig
  }
  messages: {
    permission: string
    complete: string
    error: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    error: string | null
  }
}

const DEFAULT_EVENT_CONFIG: EventConfig = {
  sound: false,
  notification: true,
}

const DEFAULT_CONFIG: NotifierConfig = {
  sound: false,
  notification: true,
  timeout: 5,
  events: {
    permission: { ...DEFAULT_EVENT_CONFIG },
    complete: { ...DEFAULT_EVENT_CONFIG },
    error: { ...DEFAULT_EVENT_CONFIG },
  },
  messages: {
    permission: "OpenCode needs permission",
    complete: "OpenCode has finished",
    error: "OpenCode encountered an error",
  },
  sounds: {
    permission: null,
    complete: null,
    error: null,
  },
}

function getConfigPath(): string {
  return join(homedir(), ".config", "opencode", "opencode-notifier.json")
}

function parseEventConfig(
  userEvent: boolean | { sound?: boolean; notification?: boolean } | undefined,
  defaultConfig: EventConfig
): EventConfig {
  if (userEvent === undefined) {
    return defaultConfig
  }

  if (typeof userEvent === "boolean") {
    return {
      sound: userEvent,
      notification: userEvent,
    }
  }

  return {
    sound: userEvent.sound ?? defaultConfig.sound,
    notification: userEvent.notification ?? defaultConfig.notification,
  }
}

export function loadConfig(): NotifierConfig {
  const configPath = getConfigPath()

  logConfigEvent({
    configPath,
    exists: existsSync(configPath)
  })

  if (!existsSync(configPath)) {
    logConfigEvent({
      result: "usingDefaultConfig",
      reason: "configFileNotFound"
    })
    return DEFAULT_CONFIG
  }

  try {
    const fileContent = readFileSync(configPath, "utf-8")
    
    logConfigEvent({
      step: "fileRead",
      rawFileContent: fileContent
    })
    
    const userConfig = JSON.parse(fileContent)

    const globalSound = userConfig.sound ?? DEFAULT_CONFIG.sound
    const globalNotification = userConfig.notification ?? DEFAULT_CONFIG.notification

    const defaultWithGlobal: EventConfig = {
      sound: globalSound,
      notification: globalNotification,
    }

    const finalConfig = {
      sound: globalSound,
      notification: globalNotification,
      timeout:
        typeof userConfig.timeout === "number" && userConfig.timeout > 0
          ? userConfig.timeout
          : DEFAULT_CONFIG.timeout,
      events: {
        permission: parseEventConfig(userConfig.events?.permission ?? userConfig.permission, defaultWithGlobal),
        complete: parseEventConfig(userConfig.events?.complete ?? userConfig.complete, defaultWithGlobal),
        error: parseEventConfig(userConfig.events?.error ?? userConfig.error, defaultWithGlobal),
      },
      messages: {
        permission: userConfig.messages?.permission ?? DEFAULT_CONFIG.messages.permission,
        complete: userConfig.messages?.complete ?? DEFAULT_CONFIG.messages.complete,
        error: userConfig.messages?.error ?? DEFAULT_CONFIG.messages.error,
      },
      sounds: {
        permission: userConfig.sounds?.permission ?? DEFAULT_CONFIG.sounds.permission,
        complete: userConfig.sounds?.complete ?? DEFAULT_CONFIG.sounds.complete,
        error: userConfig.sounds?.error ?? DEFAULT_CONFIG.sounds.error,
      },
    }

    logConfigEvent({
      result: "parsedUserConfig",
      parsedUserConfig: userConfig,
      finalConfig: finalConfig
    })

    return finalConfig
  } catch (err) {
    logConfigEvent({
      result: "parseError",
      error: String(err)
    })
    return DEFAULT_CONFIG
  }
}

export function isEventSoundEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.events[event].sound
}

export function isEventNotificationEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.events[event].notification
}

export function getMessage(config: NotifierConfig, event: EventType): string {
  return config.messages[event]
}

export function getSoundPath(config: NotifierConfig, event: EventType): string | null {
  return config.sounds[event]
}
