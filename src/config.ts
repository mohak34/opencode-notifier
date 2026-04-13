import { readFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import isWsl from "is-wsl"

export type EventType = 
  | "permission"
  | "complete"
  | "subagent_complete"
  | "error"
  | "question"
  | "interrupted"
  | "user_cancelled"
  | "plan_exit"
  | "session_started"
  | "user_message"
  | "client_connected"

export interface EventConfig {
  sound: boolean
  notification: boolean
  command: boolean
  bell: boolean
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
  agentName?: string | null
  projectName?: string | null
  timestamp?: string | null
  turn?: number | null
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  bell: boolean
  timeout: number
  showProjectName: boolean
  showSessionTitle: boolean
  showIcon: boolean
  customIconPath: string | null
  suppressWhenFocused: boolean
  enableOnDesktop: boolean
  notificationSystem: "osascript" | "node-notifier" | "ghostty"
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
    plan_exit: EventConfig
    session_started: EventConfig
    user_message: EventConfig
    client_connected: EventConfig
  }
  messages: {
    permission: string
    complete: string
    subagent_complete: string
    error: string
    question: string
    interrupted: string
    user_cancelled: string
    plan_exit: string
    session_started: string
    user_message: string
    client_connected: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    subagent_complete: string | null
    error: string | null
    question: string | null
    interrupted: string | null
    user_cancelled: string | null
    plan_exit: string | null
    session_started: string | null
    user_message: string | null
    client_connected: string | null
  }
  volumes: {
    permission: number
    complete: number
    subagent_complete: number
    error: number
    question: number
    interrupted: number
    user_cancelled: number
    plan_exit: number
    session_started: number
    user_message: number
    client_connected: number
  }
}

const DEFAULT_EVENT_CONFIG: EventConfig = {
  sound: true,
  notification: true,
  command: true,
  bell: false,
}

const DEFAULT_CONFIG: NotifierConfig = {
  sound: true,
  notification: true,
  bell: false,
  timeout: 5,
  showProjectName: true,
  showSessionTitle: false,
  showIcon: true,
  customIconPath: null,
  suppressWhenFocused: true,
  enableOnDesktop: false,
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
    subagent_complete: { ...DEFAULT_EVENT_CONFIG, sound: false, notification: false },
    error: { ...DEFAULT_EVENT_CONFIG },
    question: { ...DEFAULT_EVENT_CONFIG },
    interrupted: { ...DEFAULT_EVENT_CONFIG },
    user_cancelled: { ...DEFAULT_EVENT_CONFIG, sound: false, notification: false },
    plan_exit: { ...DEFAULT_EVENT_CONFIG },
    session_started: { ...DEFAULT_EVENT_CONFIG, notification: false },
    user_message: { ...DEFAULT_EVENT_CONFIG, notification: false },
    client_connected: { ...DEFAULT_EVENT_CONFIG, notification: false },
  },
  messages: {
    permission: "Session needs permission: {sessionTitle}",
    complete: "Session has finished: {sessionTitle}",
    subagent_complete: "Subagent task completed: {sessionTitle}",
    error: "Session encountered an error: {sessionTitle}",
    question: "Session has a question: {sessionTitle}",
    interrupted: "Session was interrupted: {sessionTitle}",
    user_cancelled: "Session was cancelled by user: {sessionTitle}",
    plan_exit: "Plan ready for review: {sessionTitle}",
    session_started: "Session started: {sessionTitle}",
    user_message: "User sent a message: {sessionTitle}",
    client_connected: "OpenCode connected",
  },
  sounds: {
    permission: null,
    complete: null,
    subagent_complete: null,
    error: null,
    question: null,
    interrupted: null,
    user_cancelled: null,
    plan_exit: null,
    session_started: null,
    user_message: null,
    client_connected: null,
  },
  volumes: {
    permission: 1,
    complete: 1,
    subagent_complete: 1,
    error: 1,
    question: 1,
    interrupted: 1,
    user_cancelled: 1,
    plan_exit: 1,
    session_started: 1,
    user_message: 1,
    client_connected: 1,
  },
}

export function getConfigPath(): string {
  if (process.env.OPENCODE_NOTIFIER_CONFIG_PATH) {
    return process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  }
  return join(homedir(), ".config", "opencode", "opencode-notifier.json")
}

export function getStatePath(): string {
  const configPath = getConfigPath()
  return join(dirname(configPath), "opencode-notifier-state.json")
}

function parseEventConfig(
  userEvent: boolean | { sound?: boolean; notification?: boolean; command?: boolean; bell?: boolean } | undefined,
  defaultConfig: EventConfig
): EventConfig {
  if (userEvent === undefined) {
    return defaultConfig
  }

  if (typeof userEvent === "boolean") {
    return {
      sound: userEvent,
      notification: userEvent,
      command: userEvent,
      bell: defaultConfig.bell,
    }
  }

  return {
    sound: userEvent.sound ?? defaultConfig.sound,
    notification: userEvent.notification ?? defaultConfig.notification,
    command: userEvent.command ?? defaultConfig.command,
    bell: userEvent.bell ?? defaultConfig.bell,
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
    const globalBell = userConfig.bell ?? DEFAULT_CONFIG.bell

    const defaultWithGlobal: EventConfig = {
      sound: globalSound,
      notification: globalNotification,
      command: true,
      bell: globalBell,
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
      bell: globalBell,
      timeout:
        typeof userConfig.timeout === "number" && userConfig.timeout > 0
          ? userConfig.timeout
          : DEFAULT_CONFIG.timeout,
      showProjectName: userConfig.showProjectName ?? DEFAULT_CONFIG.showProjectName,
      showSessionTitle: userConfig.showSessionTitle ?? DEFAULT_CONFIG.showSessionTitle,
      showIcon: userConfig.showIcon ?? DEFAULT_CONFIG.showIcon,
      customIconPath: userConfig.customIconPath ?? DEFAULT_CONFIG.customIconPath,
      suppressWhenFocused: userConfig.suppressWhenFocused ?? DEFAULT_CONFIG.suppressWhenFocused,
      enableOnDesktop: typeof userConfig.enableOnDesktop === "boolean" ? userConfig.enableOnDesktop : DEFAULT_CONFIG.enableOnDesktop,
      notificationSystem:
        userConfig.notificationSystem === "node-notifier"
          ? "node-notifier"
          : userConfig.notificationSystem === "ghostty"
            ? "ghostty"
            : "osascript",
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
        subagent_complete: parseEventConfig(userConfig.events?.subagent_complete ?? userConfig.subagent_complete, { sound: false, notification: false, command: true, bell: false }),
        error: parseEventConfig(userConfig.events?.error ?? userConfig.error, defaultWithGlobal),
        question: parseEventConfig(userConfig.events?.question ?? userConfig.question, defaultWithGlobal),
        interrupted: parseEventConfig(userConfig.events?.interrupted ?? userConfig.interrupted, defaultWithGlobal),
        user_cancelled: parseEventConfig(userConfig.events?.user_cancelled ?? userConfig.user_cancelled, { sound: false, notification: false, command: true, bell: false }),
        plan_exit: parseEventConfig(userConfig.events?.plan_exit ?? userConfig.plan_exit, defaultWithGlobal),
        session_started: parseEventConfig(userConfig.events?.session_started ?? userConfig.session_started, { ...defaultWithGlobal, notification: false }),
        user_message: parseEventConfig(userConfig.events?.user_message ?? userConfig.user_message, { ...defaultWithGlobal, notification: false }),
        client_connected: parseEventConfig(userConfig.events?.client_connected ?? userConfig.client_connected, { ...defaultWithGlobal, notification: false }),
      },
      messages: {
        permission: userConfig.messages?.permission ?? DEFAULT_CONFIG.messages.permission,
        complete: userConfig.messages?.complete ?? DEFAULT_CONFIG.messages.complete,
        subagent_complete: userConfig.messages?.subagent_complete ?? DEFAULT_CONFIG.messages.subagent_complete,
        error: userConfig.messages?.error ?? DEFAULT_CONFIG.messages.error,
        question: userConfig.messages?.question ?? DEFAULT_CONFIG.messages.question,
        interrupted: userConfig.messages?.interrupted ?? DEFAULT_CONFIG.messages.interrupted,
        user_cancelled: userConfig.messages?.user_cancelled ?? DEFAULT_CONFIG.messages.user_cancelled,
        plan_exit: userConfig.messages?.plan_exit ?? DEFAULT_CONFIG.messages.plan_exit,
        session_started: userConfig.messages?.session_started ?? DEFAULT_CONFIG.messages.session_started,
        user_message: userConfig.messages?.user_message ?? DEFAULT_CONFIG.messages.user_message,
        client_connected: userConfig.messages?.client_connected ?? DEFAULT_CONFIG.messages.client_connected,
      },
      sounds: {
        permission: userConfig.sounds?.permission ?? DEFAULT_CONFIG.sounds.permission,
        complete: userConfig.sounds?.complete ?? DEFAULT_CONFIG.sounds.complete,
        subagent_complete: userConfig.sounds?.subagent_complete ?? DEFAULT_CONFIG.sounds.subagent_complete,
        error: userConfig.sounds?.error ?? DEFAULT_CONFIG.sounds.error,
        question: userConfig.sounds?.question ?? DEFAULT_CONFIG.sounds.question,
        interrupted: userConfig.sounds?.interrupted ?? DEFAULT_CONFIG.sounds.interrupted,
        user_cancelled: userConfig.sounds?.user_cancelled ?? DEFAULT_CONFIG.sounds.user_cancelled,
        plan_exit: userConfig.sounds?.plan_exit ?? DEFAULT_CONFIG.sounds.plan_exit,
        session_started: userConfig.sounds?.session_started ?? DEFAULT_CONFIG.sounds.session_started,
        user_message: userConfig.sounds?.user_message ?? DEFAULT_CONFIG.sounds.user_message,
        client_connected: userConfig.sounds?.client_connected ?? DEFAULT_CONFIG.sounds.client_connected,
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
        plan_exit: parseVolume(userConfig.volumes?.plan_exit, DEFAULT_CONFIG.volumes.plan_exit),
        session_started: parseVolume(userConfig.volumes?.session_started, DEFAULT_CONFIG.volumes.session_started),
        user_message: parseVolume(userConfig.volumes?.user_message, DEFAULT_CONFIG.volumes.user_message),
        client_connected: parseVolume(userConfig.volumes?.client_connected, DEFAULT_CONFIG.volumes.client_connected),
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

export function isEventCommandEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.events[event].command
}

export function isEventBellEnabled(config: NotifierConfig, event: EventType): boolean {
  return config.events[event].bell
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
    let iconPath: string
    if (config.customIconPath) {
      iconPath = config.customIconPath
    } else {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      iconPath = join(__dirname, "..", "logos", "opencode-logo-dark.png")
    }

    // Don't check when invoked from WSL since it will
    // fail to verify windows path anyway (currently
    // path with backslackes needs to be specified)
    // https://github.com/mikaelbr/node-notifier/issues/354
    if (isWsl || existsSync(iconPath)) {
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

  const agentName = context.agentName || ""
  result = result.replaceAll("{agentName}", agentName)

  const projectName = context.projectName || ""
  result = result.replaceAll("{projectName}", projectName)

  const timestamp = context.timestamp || ""
  result = result.replaceAll("{timestamp}", timestamp)

  const turn = context.turn != null ? String(context.turn) : ""
  result = result.replaceAll("{turn}", turn)

  result = result.replace(/\s*[:\-|]\s*$/, "").trim()
  result = result.replace(/\s{2,}/g, " ")

  return result
}
