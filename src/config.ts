import { readFileSync, existsSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"

export type EventType = "permission" | "complete" | "subagent_complete" | "error" | "question"

export interface EventConfig {
  sound: boolean
  notification: boolean
}

export interface CommandConfig {
  enabled: boolean
  path: string
  args?: string[]
  minDuration?: number
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  timeout: number
  showProjectName: boolean
  showIcon: boolean
  notificationSystem: "osascript" | "node-notifier"
  command: CommandConfig
  events: {
    permission: EventConfig
    complete: EventConfig
    subagent_complete: EventConfig
    error: EventConfig
    question: EventConfig
  }
  messages: {
    permission: string
    complete: string
    subagent_complete: string
    error: string
    question: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    subagent_complete: string | null
    error: string | null
    question: string | null
  }
}

const DEFAULT_EVENT_CONFIG: EventConfig = {
  sound: true,
  notification: true,
}

const DEFAULT_CONFIG: NotifierConfig = {
  sound: true,
  notification: true,
  timeout: 5,
  showProjectName: true,
  showIcon: true,
  notificationSystem: "osascript",
  command: {
    enabled: false,
    path: "",
    minDuration: 0,
  },
  events: {
    permission: { ...DEFAULT_EVENT_CONFIG },
    complete: { ...DEFAULT_EVENT_CONFIG },
    subagent_complete: { sound: false, notification: false },
    error: { ...DEFAULT_EVENT_CONFIG },
    question: { ...DEFAULT_EVENT_CONFIG },
  },
  messages: {
    permission: "Session needs permission",
    complete: "Session has finished",
    subagent_complete: "Subagent task completed",
    error: "Session encountered an error",
    question: "Session has a question",
  },
  sounds: {
    permission: null,
    complete: null,
    subagent_complete: null,
    error: null,
    question: null,
  },
}

export function getConfigPath(): string {
  if (process.env.OPENCODE_NOTIFIER_CONFIG_PATH) {
    return process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  }
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

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const fileContent = readFileSync(configPath, "utf-8")
    const userConfig = JSON.parse(fileContent)

    const globalSound = userConfig.sound ?? DEFAULT_CONFIG.sound
    const globalNotification = userConfig.notification ?? DEFAULT_CONFIG.notification

    const defaultWithGlobal: EventConfig = {
      sound: globalSound,
      notification: globalNotification,
    }

    const userCommand = userConfig.command ?? {}
    const commandArgs = Array.isArray(userCommand.args)
      ? userCommand.args.filter((arg: unknown) => typeof arg === "string")
      : undefined

    const commandMinDuration =
      typeof userCommand.minDuration === "number" &&
      Number.isFinite(userCommand.minDuration) &&
      userCommand.minDuration > 0
        ? userCommand.minDuration
        : 0

    return {
      sound: globalSound,
      notification: globalNotification,
      timeout:
        typeof userConfig.timeout === "number" && userConfig.timeout > 0
          ? userConfig.timeout
          : DEFAULT_CONFIG.timeout,
      showProjectName: userConfig.showProjectName ?? DEFAULT_CONFIG.showProjectName,
      showIcon: userConfig.showIcon ?? DEFAULT_CONFIG.showIcon,
      notificationSystem: userConfig.notificationSystem === "node-notifier" ? "node-notifier" : "osascript",
      command: {
        enabled: typeof userCommand.enabled === "boolean" ? userCommand.enabled : DEFAULT_CONFIG.command.enabled,
        path: typeof userCommand.path === "string" ? userCommand.path : DEFAULT_CONFIG.command.path,
        args: commandArgs,
        minDuration: commandMinDuration,
      },
      events: {
        permission: parseEventConfig(userConfig.events?.permission ?? userConfig.permission, defaultWithGlobal),
        complete: parseEventConfig(userConfig.events?.complete ?? userConfig.complete, defaultWithGlobal),
        subagent_complete: parseEventConfig(userConfig.events?.subagent_complete ?? userConfig.subagent_complete, { sound: false, notification: false }),
        error: parseEventConfig(userConfig.events?.error ?? userConfig.error, defaultWithGlobal),
        question: parseEventConfig(userConfig.events?.question ?? userConfig.question, defaultWithGlobal),
      },
      messages: {
        permission: userConfig.messages?.permission ?? DEFAULT_CONFIG.messages.permission,
        complete: userConfig.messages?.complete ?? DEFAULT_CONFIG.messages.complete,
        subagent_complete: userConfig.messages?.subagent_complete ?? DEFAULT_CONFIG.messages.subagent_complete,
        error: userConfig.messages?.error ?? DEFAULT_CONFIG.messages.error,
        question: userConfig.messages?.question ?? DEFAULT_CONFIG.messages.question,
      },
      sounds: {
        permission: userConfig.sounds?.permission ?? DEFAULT_CONFIG.sounds.permission,
        complete: userConfig.sounds?.complete ?? DEFAULT_CONFIG.sounds.complete,
        subagent_complete: userConfig.sounds?.subagent_complete ?? DEFAULT_CONFIG.sounds.subagent_complete,
        error: userConfig.sounds?.error ?? DEFAULT_CONFIG.sounds.error,
        question: userConfig.sounds?.question ?? DEFAULT_CONFIG.sounds.question,
      },
    }
  } catch {
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

export function getIconPath(config: NotifierConfig): string | undefined {
  if (!config.showIcon) {
    return undefined
  }
  
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const iconPath = join(__dirname, "..", "logos", "opencode-logo-dark.png")
    
    if (existsSync(iconPath)) {
      return iconPath
    }
  } catch {
    // Ignore errors - notifications will work without icon
  }
  
  return undefined
}

export function saveConfig(config: NotifierConfig): void {
  const configPath = getConfigPath()
  
  const userConfig: Record<string, unknown> = {
    sound: config.sound,
    notification: config.notification,
    timeout: config.timeout,
    showProjectName: config.showProjectName,
    showIcon: config.showIcon,
    notificationSystem: config.notificationSystem,
  }

  const defaultWithGlobal: EventConfig = {
    sound: config.sound,
    notification: config.notification,
  }

  userConfig.events = {
    permission: config.events.permission.sound !== defaultWithGlobal.sound || config.events.permission.notification !== defaultWithGlobal.notification 
      ? config.events.permission 
      : undefined,
    complete: config.events.complete.sound !== defaultWithGlobal.sound || config.events.complete.notification !== defaultWithGlobal.notification 
      ? config.events.complete 
      : undefined,
    subagent_complete: config.events.subagent_complete.sound !== false || config.events.subagent_complete.notification !== false 
      ? config.events.subagent_complete 
      : undefined,
    error: config.events.error.sound !== defaultWithGlobal.sound || config.events.error.notification !== defaultWithGlobal.notification 
      ? config.events.error 
      : undefined,
    question: config.events.question.sound !== defaultWithGlobal.sound || config.events.question.notification !== defaultWithGlobal.notification 
      ? config.events.question 
      : undefined,
  }

  if (config.command.enabled || config.command.path) {
    userConfig.command = {
      enabled: config.command.enabled,
      path: config.command.path,
      args: config.command.args,
      minDuration: config.command.minDuration,
    }
  }

  userConfig.messages = config.messages

  const cleanedConfig: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(userConfig)) {
    if (value !== undefined) {
      cleanedConfig[key] = value
    }
  }

  const nestedEvents = cleanedConfig.events as Record<string, unknown> | undefined
  if (nestedEvents) {
    for (const [key, value] of Object.entries(nestedEvents)) {
      if (value === undefined) {
        delete nestedEvents[key]
      }
    }
    if (Object.keys(nestedEvents).length === 0) {
      delete cleanedConfig.events
    }
  }

  writeFileSync(configPath, JSON.stringify(cleanedConfig, null, 2) + "\n", "utf-8")
}
