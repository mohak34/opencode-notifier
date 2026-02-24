import { readFileSync, existsSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"

export type EventType = "permission" | "complete" | "subagent_complete" | "error" | "question" | "interrupted" | "user_cancelled"

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

export interface LinuxConfig {
  grouping: boolean
}

export interface MessageContext {
  sessionTitle?: string | null
  projectName?: string | null
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  timeout: number
  showProjectName: boolean
  showSessionTitle: boolean
  showIcon: boolean
  notificationSystem: "osascript" | "node-notifier"
  linux: LinuxConfig
  command: CommandConfig
  events: {
    permission: EventConfig
    complete: EventConfig
    subagent_complete: EventConfig
    error: EventConfig
    question: EventConfig
    interrupted: EventConfig
    user_cancelled: EventConfig
  }
  messages: {
    permission: string
    complete: string
    subagent_complete: string
    error: string
    question: string
    interrupted: string
    user_cancelled: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    subagent_complete: string | null
    error: string | null
    question: string | null
    interrupted: string | null
    user_cancelled: string | null
  }
  volumes: {
    permission: number
    complete: number
    subagent_complete: number
    error: number
    question: number
    interrupted: number
    user_cancelled: number
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
  showSessionTitle: false,
  showIcon: true,
  notificationSystem: "osascript",
  linux: {
    grouping: false,
  },
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
    interrupted: { ...DEFAULT_EVENT_CONFIG },
    user_cancelled: { sound: false, notification: false },
  },
  messages: {
    permission: "Session needs permission: {sessionTitle}",
    complete: "Session has finished: {sessionTitle}",
    subagent_complete: "Subagent task completed: {sessionTitle}",
    error: "Session encountered an error: {sessionTitle}",
    question: "Session has a question: {sessionTitle}",
    interrupted: "Session was interrupted: {sessionTitle}",
    user_cancelled: "Session was cancelled: {sessionTitle}",
  },
  sounds: {
    permission: null,
    complete: null,
    subagent_complete: null,
    error: null,
    question: null,
    interrupted: null,
    user_cancelled: null,
  },
  volumes: {
    permission: 1,
    complete: 1,
    subagent_complete: 1,
    error: 1,
    question: 1,
    interrupted: 1,
    user_cancelled: 1,
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

function parseVolume(value: unknown, defaultVolume: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultVolume
  }

  if (value < 0) {
    return 0
  }

  if (value > 1) {
    return 1
  }

  return value
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
      showSessionTitle: userConfig.showSessionTitle ?? DEFAULT_CONFIG.showSessionTitle,
      showIcon: userConfig.showIcon ?? DEFAULT_CONFIG.showIcon,
      notificationSystem: userConfig.notificationSystem === "node-notifier" ? "node-notifier" : "osascript",
      linux: {
        grouping: typeof userConfig.linux?.grouping === "boolean" ? userConfig.linux.grouping : DEFAULT_CONFIG.linux.grouping,
      },
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
        interrupted: parseEventConfig(userConfig.events?.interrupted ?? userConfig.interrupted, defaultWithGlobal),
        user_cancelled: parseEventConfig(userConfig.events?.user_cancelled ?? userConfig.user_cancelled, { sound: false, notification: false }),
      },
      messages: {
        permission: userConfig.messages?.permission ?? DEFAULT_CONFIG.messages.permission,
        complete: userConfig.messages?.complete ?? DEFAULT_CONFIG.messages.complete,
        subagent_complete: userConfig.messages?.subagent_complete ?? DEFAULT_CONFIG.messages.subagent_complete,
        error: userConfig.messages?.error ?? DEFAULT_CONFIG.messages.error,
        question: userConfig.messages?.question ?? DEFAULT_CONFIG.messages.question,
        interrupted: userConfig.messages?.interrupted ?? DEFAULT_CONFIG.messages.interrupted,
        user_cancelled: userConfig.messages?.user_cancelled ?? DEFAULT_CONFIG.messages.user_cancelled,
      },
      sounds: {
        permission: userConfig.sounds?.permission ?? DEFAULT_CONFIG.sounds.permission,
        complete: userConfig.sounds?.complete ?? DEFAULT_CONFIG.sounds.complete,
        subagent_complete: userConfig.sounds?.subagent_complete ?? DEFAULT_CONFIG.sounds.subagent_complete,
        error: userConfig.sounds?.error ?? DEFAULT_CONFIG.sounds.error,
        question: userConfig.sounds?.question ?? DEFAULT_CONFIG.sounds.question,
        interrupted: userConfig.sounds?.interrupted ?? DEFAULT_CONFIG.sounds.interrupted,
        user_cancelled: userConfig.sounds?.user_cancelled ?? DEFAULT_CONFIG.sounds.user_cancelled,
      },
      volumes: {
        permission: parseVolume(userConfig.volumes?.permission, DEFAULT_CONFIG.volumes.permission),
        complete: parseVolume(userConfig.volumes?.complete, DEFAULT_CONFIG.volumes.complete),
        subagent_complete: parseVolume(
          userConfig.volumes?.subagent_complete,
          DEFAULT_CONFIG.volumes.subagent_complete
        ),
        error: parseVolume(userConfig.volumes?.error, DEFAULT_CONFIG.volumes.error),
        question: parseVolume(userConfig.volumes?.question, DEFAULT_CONFIG.volumes.question),
        interrupted: parseVolume(userConfig.volumes?.interrupted, DEFAULT_CONFIG.volumes.interrupted),
        user_cancelled: parseVolume(userConfig.volumes?.user_cancelled, DEFAULT_CONFIG.volumes.user_cancelled),
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

export function getSoundVolume(config: NotifierConfig, event: EventType): number {
  return config.volumes[event]
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

export function interpolateMessage(message: string, context: MessageContext): string {
  let result = message

  const sessionTitle = context.sessionTitle || ""
  result = result.replaceAll("{sessionTitle}", sessionTitle)

  const projectName = context.projectName || ""
  result = result.replaceAll("{projectName}", projectName)

  // Clean up artifacts from empty placeholder replacements
  // Remove trailing separators like ": ", " - ", " | " left after empty substitution
  result = result.replace(/\s*[:\-|]\s*$/, "").trim()
  // Collapse multiple spaces into one
  result = result.replace(/\s{2,}/g, " ")

  return result
}
