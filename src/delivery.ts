import { readFileSync, writeFileSync } from "fs"
import {
  isEventSoundEnabled,
  isEventNotificationEnabled,
  isEventCommandEnabled,
  isEventBellEnabled,
  getMessage,
  getSoundPath,
  getSoundVolume,
  getIconPath,
  interpolateMessage,
  getStatePath,
  CHANNELS,
} from "./config"
import type { Channel, EventType, MessageContext, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { ringBell } from "./bell"
import { runCommand } from "./command"
import { isTerminalFocused, focusTerminal, isTerminalJumpBackSupported, debugFocusState } from "./focus"

let globalTurnCount: number | null = null

function loadTurnCount(): number {
  try {
    const content = readFileSync(getStatePath(), "utf-8")
    const state = JSON.parse(content)
    if (typeof state.turn === "number" && Number.isFinite(state.turn) && state.turn >= 0) {
      return state.turn
    }
  } catch {}
  return 0
}

function saveTurnCount(count: number): void {
  try {
    writeFileSync(getStatePath(), JSON.stringify({ turn: count }))
  } catch {}
}

function incrementTurnCount(): number {
  if (globalTurnCount === null) {
    globalTurnCount = loadTurnCount()
  }
  globalTurnCount++
  saveTurnCount(globalTurnCount)
  return globalTurnCount
}

function getNotificationTitle(config: NotifierConfig, context: MessageContext): string {
  if (config.notificationTitle !== null) {
    const title = interpolateMessage(config.notificationTitle, context)
    if (title) return title
  }
  if (config.showProjectName && context.projectName) {
    return `OpenCode (${context.projectName})`
  }
  return "OpenCode"
}

function formatTimestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, "0")
  const m = String(now.getMinutes()).padStart(2, "0")
  const s = String(now.getSeconds()).padStart(2, "0")
  return `${h}:${m}:${s}`
}

export function extractAgentNameFromSessionTitle(sessionTitle: unknown): string {
  if (typeof sessionTitle !== "string" || sessionTitle.length === 0) {
    return ""
  }

  const match = sessionTitle.match(/\s*\(@([^\s)]+)\s+subagent\)\s*$/)
  return match ? match[1] : ""
}

export function shouldResolveSessionContextForEvent(config: NotifierConfig, eventType: EventType): boolean {
  if (getMessage(config, eventType).includes("{agentName}")) return true

  if (isEventNotificationEnabled(config, eventType) && config.notificationTitle &&
      (config.notificationTitle.includes("{agentName}") || config.notificationTitle.includes("{sessionTitle}"))) return true

  const commands = []
  if (isEventNotificationEnabled(config, eventType)) commands.push(config.onClickCommand)
  if (isEventCommandEnabled(config, eventType)) commands.push(config.command)
  return commands.some(command => command.enabled && [command.path, ...(command.args ?? [])]
    .some(value => value.includes("{agentName}") || value.includes("{sessionTitle}")))
}

export async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  elapsedSeconds?: number | null,
  sessionTitle?: string | null,
  sessionID?: string | null,
  agentName?: string | null
): Promise<void> {
  // Focus is only queried when some channel cares about it.
  const focusChannels = config.suppressWhenFocused === true ? CHANNELS : config.suppressWhenFocused || []
  const muted = new Set<Channel>(focusChannels.length > 0 && isTerminalFocused() ? focusChannels : [])
  if (muted.size === CHANNELS.length) {
    return
  }

  if (
    (eventType === "complete" || eventType === "subagent_complete") &&
    typeof elapsedSeconds === "number" &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds < config.minDuration
  ) {
    return
  }

  const promises: Promise<void>[] = []

  const timestamp = formatTimestamp()
  const turn = incrementTurnCount()

  const rawMessage = getMessage(config, eventType)
  const context: MessageContext = {
    sessionTitle: config.showSessionTitle ? sessionTitle : null,
    agentName,
    projectName,
    timestamp,
    turn,
  }
  const message = interpolateMessage(rawMessage, context)

  const notificationEnabled = isEventNotificationEnabled(config, eventType) && !muted.has("notification")
  if (notificationEnabled) {
    const title = getNotificationTitle(config, context)
    const iconPath = getIconPath(config)
    const focusOnClick = config.focusOnClick && isTerminalJumpBackSupported()
    const clickCommand = config.onClickCommand
    let clicked = false
    const onNotificationClick = focusOnClick || (clickCommand.enabled && clickCommand.path) ? () => {
      if (clicked) return
      clicked = true
      debugFocusState(`notification activated (event=${eventType}), focusOnClick=${focusOnClick}`)
      if (clickCommand.enabled) {
        runCommand({ ...config, command: clickCommand }, eventType, message, sessionTitle, agentName, projectName, timestamp, turn, sessionID)
      }
      if (focusOnClick) void focusTerminal().then(
        () => debugFocusState("focusTerminal() finished"),
        (error) => debugFocusState(`focusTerminal() threw: ${String(error)}`)
      )
    } : undefined
    promises.push(sendNotification(title, message, config.timeout, iconPath, config.notificationSystem, config.linux.grouping,
      onNotificationClick, config.windows.appID, focusOnClick ? "Jump to terminal" : "Run command"))
  }

  if (isEventSoundEnabled(config, eventType) && !muted.has("sound")) {
    const customSoundPath = getSoundPath(config, eventType)
    const ghosttyOnMac = process.platform === "darwin" && config.notificationSystem === "ghostty" && notificationEnabled && config.suppressGhosttySound
    if (!ghosttyOnMac) {
      const soundVolume = getSoundVolume(config, eventType)
      promises.push(playSound(eventType, customSoundPath, soundVolume))
    }
  }

  if (isEventBellEnabled(config, eventType) && !muted.has("bell")) {
    promises.push(ringBell())
  }

  const minDuration = config.command?.minDuration
  const shouldSkipCommand =
    !isEventCommandEnabled(config, eventType) ||
    muted.has("command") ||
    (typeof minDuration === "number" &&
      Number.isFinite(minDuration) &&
      minDuration > 0 &&
      typeof elapsedSeconds === "number" &&
      Number.isFinite(elapsedSeconds) &&
      elapsedSeconds < minDuration)

  if (!shouldSkipCommand) {
    runCommand(config, eventType, message, sessionTitle, agentName, projectName, timestamp, turn, sessionID)
  }

  await Promise.allSettled(promises)
}
