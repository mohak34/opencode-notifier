import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { parseJSONC } from "confbox"

import { logEvent } from "./debug-logging"

export type EventType = "permission" | "complete" | "error" | "subagent"

export const DEBOUNCE_MS = 1000
export const RACE_CONDITION_DEBOUNCE_MS = 150

export interface EventConfig {
  sound: boolean
  notification: boolean
}

export interface NotifierConfig {
  sound: boolean
  notification: boolean
  timeout: number
  volume: number
  events: {
    permission: EventConfig
    complete: EventConfig
    error: EventConfig
    subagent: EventConfig
  }
  messages: {
    permission: string
    complete: string
    error: string
    subagent: string
  }
  sounds: {
    permission: string | null
    complete: string | null
    error: string | null
    subagent: string | null
  }
  images: {
    permission: string | null
    complete: string | null
    error: string | null
    subagent: string | null
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
  volume: 1.0,
  events: {
    permission: { ...DEFAULT_EVENT_CONFIG },
    complete: { ...DEFAULT_EVENT_CONFIG },
    error: { ...DEFAULT_EVENT_CONFIG },
    subagent: { sound: false, notification: false }, // Disabled by default
  },
  messages: {
    permission: "OpenCode needs permission",
    complete: "OpenCode has finished",
    error: "OpenCode encountered an error",
    subagent: "Subagent task completed",
  },
  sounds: {
    permission: null,
    complete: null,
    error: null,
    subagent: null,
  },
  images: {
    permission: null,
    complete: null,
    error: null,
    subagent: null,
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

type UserEventConfig = boolean | { sound?: boolean; notification?: boolean }

export function loadConfig(): NotifierConfig {
  const configPath = getConfigPath()

  logEvent({
    action: "loadConfig",
    configPath,
    exists: existsSync(configPath)
  })

  if (!existsSync(configPath)) {
    logEvent({
      action: "loadConfig",
      result: "usingDefaultConfig",
      reason: "configFileNotFound"
    })
    return DEFAULT_CONFIG
  }

  try {
    const fileContent = readFileSync(configPath, "utf-8")
    const parsedData = parseJSONC(fileContent)

    if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) {
      logEvent({
        action: "loadConfig",
        result: "parseError",
        error: "Invalid config object"
      })
      return DEFAULT_CONFIG
    }

    const userConfig = parsedData as Record<string, unknown>

    const globalSound = (userConfig.sound as boolean | undefined) ?? DEFAULT_CONFIG.sound
    const globalNotification = (userConfig.notification as boolean | undefined) ?? DEFAULT_CONFIG.notification

    const defaultWithGlobal: EventConfig = {
      sound: globalSound,
      notification: globalNotification,
    }

    const events = (userConfig.events as Record<string, UserEventConfig> | undefined) ?? {}
    const messages = (userConfig.messages as Record<string, string> | undefined) ?? {}
    const sounds = (userConfig.sounds as Record<string, string | null> | undefined) ?? {}
    const images = (userConfig.images as Record<string, string | null> | undefined) ?? {}

    return {
      sound: globalSound,
      notification: globalNotification,
      timeout:
        typeof userConfig.timeout === "number" && userConfig.timeout > 0
          ? userConfig.timeout
          : DEFAULT_CONFIG.timeout,
      volume:
        typeof userConfig.volume === "number" && userConfig.volume > 0 && userConfig.volume <= 1
          ? userConfig.volume
          : DEFAULT_CONFIG.volume,
      events: {
        permission: parseEventConfig(events.permission ?? (userConfig.permission as UserEventConfig | undefined), defaultWithGlobal),
        complete: parseEventConfig(events.complete ?? (userConfig.complete as UserEventConfig | undefined), defaultWithGlobal),
        error: parseEventConfig(events.error ?? (userConfig.error as UserEventConfig | undefined), defaultWithGlobal),
        subagent: parseEventConfig(events.subagent ?? (userConfig.subagent as UserEventConfig | undefined), DEFAULT_CONFIG.events.subagent),
      },
      messages: {
        permission: messages.permission ?? (typeof userConfig.permission === "string" ? userConfig.permission : undefined) ?? DEFAULT_CONFIG.messages.permission,
        complete: messages.complete ?? (typeof userConfig.complete === "string" ? userConfig.complete : undefined) ?? DEFAULT_CONFIG.messages.complete,
        error: messages.error ?? (typeof userConfig.error === "string" ? userConfig.error : undefined) ?? DEFAULT_CONFIG.messages.error,
        subagent: messages.subagent ?? (typeof userConfig.subagent === "string" ? userConfig.subagent : undefined) ?? DEFAULT_CONFIG.messages.subagent,
      },
      sounds: {
        permission: sounds.permission ?? (typeof userConfig.permission === "string" ? userConfig.permission : null) ?? DEFAULT_CONFIG.sounds.permission,
        complete: sounds.complete ?? (typeof userConfig.complete === "string" ? userConfig.complete : null) ?? DEFAULT_CONFIG.sounds.complete,
        error: sounds.error ?? (typeof userConfig.error === "string" ? userConfig.error : null) ?? DEFAULT_CONFIG.sounds.error,
        subagent: sounds.subagent ?? (typeof userConfig.subagent === "string" ? userConfig.subagent : null) ?? DEFAULT_CONFIG.sounds.subagent,
      },
      images: {
        permission: images.permission ?? (typeof userConfig.permission === "string" ? userConfig.permission : null) ?? DEFAULT_CONFIG.images.permission,
        complete: images.complete ?? (typeof userConfig.complete === "string" ? userConfig.complete : null) ?? DEFAULT_CONFIG.images.complete,
        error: images.error ?? (typeof userConfig.error === "string" ? userConfig.error : null) ?? DEFAULT_CONFIG.images.error,
        subagent: images.subagent ?? (typeof userConfig.subagent === "string" ? userConfig.subagent : null) ?? DEFAULT_CONFIG.images.subagent,
      },
    }
  } catch (err) {
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

export function getVolume(config: NotifierConfig): number {
  return config.volume
}

export function getImagePath(config: NotifierConfig, event: EventType): string | null {
  return config.images[event]
}
