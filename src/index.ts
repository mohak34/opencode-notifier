import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { basename } from "path"
import {
  loadConfig,
  isEventSoundEnabled,
  isEventNotificationEnabled,
  getMessage,
  getSoundPath,
  getSoundVolume,
  getIconPath,
  interpolateMessage,
} from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { runCommand } from "./command"

const IDLE_COMPLETE_DELAY_MS = 350

const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sessionIdleSequence = new Map<string, number>()
const sessionErrorSuppressionAt = new Map<string, number>()
const sessionLastBusyAt = new Map<string, number>()

// Memory cleanup: Remove old session entries every 5 minutes to prevent leaks
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000 // 5 minutes ago

  // Clean up sessionIdleSequence (use last access time stored separately if needed)
  for (const [sessionID] of sessionIdleSequence) {
    // If not in pendingIdleTimers, it's likely stale
    if (!pendingIdleTimers.has(sessionID)) {
      sessionIdleSequence.delete(sessionID)
    }
  }

  // Clean up sessionErrorSuppressionAt
  for (const [sessionID, timestamp] of sessionErrorSuppressionAt) {
    if (timestamp < cutoff) {
      sessionErrorSuppressionAt.delete(sessionID)
    }
  }

  // Clean up sessionLastBusyAt
  for (const [sessionID, timestamp] of sessionLastBusyAt) {
    if (timestamp < cutoff) {
      sessionLastBusyAt.delete(sessionID)
    }
  }
}, 5 * 60 * 1000)

function getNotificationTitle(config: NotifierConfig, projectName: string | null): string {
  if (config.showProjectName && projectName) {
    return `OpenCode (${projectName})`
  }
  return "OpenCode"
}

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  elapsedSeconds?: number | null,
  sessionTitle?: string | null
): Promise<void> {
  const promises: Promise<void>[] = []

  const rawMessage = getMessage(config, eventType)
  const message = interpolateMessage(rawMessage, {
    sessionTitle: config.showSessionTitle ? sessionTitle : null,
    projectName,
  })

  if (isEventNotificationEnabled(config, eventType)) {
    const title = getNotificationTitle(config, projectName)
    const iconPath = getIconPath(config)
    promises.push(sendNotification(title, message, config.timeout, iconPath, config.notificationSystem, config.linux.grouping))
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    const soundVolume = getSoundVolume(config, eventType)
    promises.push(playSound(eventType, customSoundPath, soundVolume))
  }

  const minDuration = config.command?.minDuration
  const shouldSkipCommand =
    typeof minDuration === "number" &&
    Number.isFinite(minDuration) &&
    minDuration > 0 &&
    typeof elapsedSeconds === "number" &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds < minDuration

  if (!shouldSkipCommand) {
    runCommand(config, eventType, message, sessionTitle, projectName)
  }

  await Promise.allSettled(promises)
}

function getSessionIDFromEvent(event: unknown): string | null {
  const sessionID = (event as any)?.properties?.sessionID
  if (typeof sessionID === "string" && sessionID.length > 0) {
    return sessionID
  }
  return null
}

function clearPendingIdleTimer(sessionID: string): void {
  const timer = pendingIdleTimers.get(sessionID)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  pendingIdleTimers.delete(sessionID)
}

function bumpSessionIdleSequence(sessionID: string): number {
  const nextSequence = (sessionIdleSequence.get(sessionID) ?? 0) + 1
  sessionIdleSequence.set(sessionID, nextSequence)
  return nextSequence
}

function hasCurrentSessionIdleSequence(sessionID: string, sequence: number): boolean {
  return sessionIdleSequence.get(sessionID) === sequence
}

function markSessionError(sessionID: string | null): void {
  if (!sessionID) {
    return
  }

  sessionErrorSuppressionAt.set(sessionID, Date.now())
  bumpSessionIdleSequence(sessionID)
  clearPendingIdleTimer(sessionID)
}

function markSessionBusy(sessionID: string): void {
  const now = Date.now()
  sessionLastBusyAt.set(sessionID, now)
  sessionErrorSuppressionAt.delete(sessionID)
  bumpSessionIdleSequence(sessionID)
  clearPendingIdleTimer(sessionID)
}

function shouldSuppressSessionIdle(sessionID: string, consume: boolean = true): boolean {
  const errorAt = sessionErrorSuppressionAt.get(sessionID)
  if (errorAt === undefined) {
    return false
  }

  const busyAt = sessionLastBusyAt.get(sessionID)
  if (typeof busyAt === "number" && busyAt > errorAt) {
    sessionErrorSuppressionAt.delete(sessionID)
    return false
  }

  if (consume) {
    sessionErrorSuppressionAt.delete(sessionID)
  }
  return true
}

function isUserCancelledError(event: unknown): boolean {
  return (event as any)?.properties?.error?.name === "MessageAbortedError"
}

async function getElapsedSinceLastPrompt(
  client: PluginInput["client"],
  sessionID: string,
  nowMs: number = Date.now()
): Promise<number | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = response.data ?? []

    let lastUserMessageTime: number | null = null
    for (const msg of messages) {
      const info = msg.info
      if (info.role === "user" && typeof info.time?.created === "number") {
        if (lastUserMessageTime === null || info.time.created > lastUserMessageTime) {
          lastUserMessageTime = info.time.created
        }
      }
    }

    if (lastUserMessageTime !== null) {
      return (nowMs - lastUserMessageTime) / 1000
    }
  } catch {
  }

  return null
}

interface SessionInfo {
  isChild: boolean
  title: string | null
}

async function getSessionInfo(
  client: PluginInput["client"],
  sessionID: string
): Promise<SessionInfo> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    return {
      isChild: !!response.data?.parentID,
      title: response.data?.title ?? null,
    }
  } catch {
    return { isChild: false, title: null }
  }
}

async function processSessionIdle(
  client: PluginInput["client"],
  config: NotifierConfig,
  projectName: string | null,
  event: unknown,
  sessionID: string,
  sequence: number,
  idleReceivedAtMs: number
): Promise<void> {
  if (!hasCurrentSessionIdleSequence(sessionID, sequence)) {
    return
  }

  if (shouldSuppressSessionIdle(sessionID)) {
    return
  }

  const sessionInfo = await getSessionInfo(client, sessionID)

  if (!hasCurrentSessionIdleSequence(sessionID, sequence)) {
    return
  }

  if (shouldSuppressSessionIdle(sessionID)) {
    return
  }

  if (!sessionInfo.isChild) {
    await handleEventWithElapsedTime(client, config, "complete", projectName, event, idleReceivedAtMs, sessionInfo.title)
    return
  }

  await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, event, idleReceivedAtMs, sessionInfo.title)
}

function scheduleSessionIdle(
  client: PluginInput["client"],
  config: NotifierConfig,
  projectName: string | null,
  event: unknown,
  sessionID: string
): void {
  clearPendingIdleTimer(sessionID)
  const sequence = bumpSessionIdleSequence(sessionID)
  const idleReceivedAtMs = Date.now()

  const timer = setTimeout(() => {
    pendingIdleTimers.delete(sessionID)
    void processSessionIdle(client, config, projectName, event, sessionID, sequence, idleReceivedAtMs).catch(() => undefined)
  }, IDLE_COMPLETE_DELAY_MS)

  pendingIdleTimers.set(sessionID, timer)
}

async function handleEventWithElapsedTime(
  client: PluginInput["client"],
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  event: unknown,
  elapsedReferenceNowMs?: number,
  preloadedSessionTitle?: string | null
): Promise<void> {
  const sessionID = getSessionIDFromEvent(event)
  const minDuration = config.command?.minDuration
  const shouldLookupElapsed =
    !!config.command?.enabled &&
    typeof config.command?.path === "string" &&
    config.command.path.length > 0 &&
    typeof minDuration === "number" &&
    Number.isFinite(minDuration) &&
    minDuration > 0

  let elapsedSeconds: number | null = null
  if (shouldLookupElapsed) {
    if (sessionID) {
      elapsedSeconds = await getElapsedSinceLastPrompt(client, sessionID, elapsedReferenceNowMs)
    }
  }

  let sessionTitle: string | null = preloadedSessionTitle ?? null
  if (sessionID && !sessionTitle && config.showSessionTitle) {
    const info = await getSessionInfo(client, sessionID)
    sessionTitle = info.title
  }

  await handleEvent(config, eventType, projectName, elapsedSeconds, sessionTitle)
}

export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  const getConfig = () => loadConfig()
  const projectName = directory ? basename(directory) : null

  return {
    event: async ({ event }) => {
      const config = getConfig()
      if (event.type === "permission.updated") {
        await handleEventWithElapsedTime(client, config, "permission", projectName, event)
      }

      if ((event as any).type === "permission.asked") {
        await handleEventWithElapsedTime(client, config, "permission", projectName, event)
      }

      if (event.type === "session.idle") {
        const sessionID = getSessionIDFromEvent(event)
        if (sessionID) {
          scheduleSessionIdle(client, config, projectName, event, sessionID)
        } else {
          await handleEventWithElapsedTime(client, config, "complete", projectName, event)
        }
      }

      if (event.type === "session.status" && event.properties.status.type === "busy") {
        markSessionBusy(event.properties.sessionID)
      }

      if (event.type === "session.error") {

        const sessionID = getSessionIDFromEvent(event)
        markSessionError(sessionID)
        
        const eventType = isUserCancelledError(event) ? "user_cancelled" : "error"
        
        let sessionTitle: string | null = null
        if (sessionID && config.showSessionTitle) {
          const info = await getSessionInfo(client, sessionID)
          sessionTitle = info.title
        }
        await handleEventWithElapsedTime(client, config, eventType, projectName, event, undefined, sessionTitle)
      }
    },
    "permission.ask": async () => {
      const config = getConfig()
      await handleEvent(config, "permission", projectName, null)
    },
    "tool.execute.before": async (input) => {
      const config = getConfig()
      if (input.tool === "question") {
        await handleEvent(config, "question", projectName, null)
      }
    },
  }
}

export default NotifierPlugin
