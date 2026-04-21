import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { basename } from "path"
import { readFileSync, writeFileSync } from "fs"
import {
  loadConfig,
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
} from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { ringBell } from "./bell"
import { runCommand } from "./command"
import { isTerminalFocused, focusTerminal, captureStartupWindowId, isKDEJumpBackSupported } from "./focus"
import { shouldSuppressPermissionAlert, prunePermissionAlertState } from "./permission-dedupe"

const IDLE_COMPLETE_DELAY_MS = 350

const pendingIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sessionIdleSequence = new Map<string, number>()
const sessionErrorSuppressionAt = new Map<string, number>()
const sessionLastBusyAt = new Map<string, number>()
const subagentSessionIds = new Set<string>()

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null
}

function getNestedRecord(root: unknown, ...path: string[]): UnknownRecord | null {
  let current: unknown = root
  for (const key of path) {
    const record = asRecord(current)
    if (!record || !(key in record)) {
      return null
    }
    current = record[key]
  }
  return asRecord(current)
}

function getStringField(record: UnknownRecord | null, key: string): string | null {
  if (!record) {
    return null
  }
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

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

// Memory cleanup: Remove old session entries every 5 minutes to prevent leaks
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000 // 5 minutes ago

  // Clean up sessionIdleSequence (use last access time stored separately if needed)
  for (const [sessionID] of sessionIdleSequence) {
    // If not in pendingIdleTimers, it's likely stale
    if (!pendingIdleTimers.has(sessionID)) {
      sessionIdleSequence.delete(sessionID)
      // Also remove from subagent tracking if stale
      subagentSessionIds.delete(sessionID)
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

  prunePermissionAlertState(cutoff)
}, 5 * 60 * 1000)

function getNotificationTitle(config: NotifierConfig, projectName: string | null): string {
  if (config.showProjectName && projectName) {
    return `OpenCode (${projectName})`
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

function shouldResolveAgentNameForEvent(config: NotifierConfig, eventType: EventType): boolean {
  if (getMessage(config, eventType).includes("{agentName}")) {
    return true
  }

  if (!config.command.enabled || !isEventCommandEnabled(config, eventType)) {
    return false
  }

  if (config.command.path.includes("{agentName}")) {
    return true
  }

  return (config.command.args ?? []).some((arg) => arg.includes("{agentName}"))
}

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  elapsedSeconds?: number | null,
  sessionTitle?: string | null,
  sessionID?: string | null,
  agentName?: string | null
): Promise<void> {
  if (config.suppressWhenFocused && isTerminalFocused()) {
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
  const message = interpolateMessage(rawMessage, {
    sessionTitle: config.showSessionTitle ? sessionTitle : null,
    agentName,
    projectName,
    timestamp,
    turn,
  })

  if (isEventNotificationEnabled(config, eventType)) {
    const title = getNotificationTitle(config, projectName)
    const iconPath = getIconPath(config)
    const onNotificationClick = isKDEJumpBackSupported() ? () => void focusTerminal() : undefined
    promises.push(sendNotification(title, message, config.timeout, iconPath, config.notificationSystem, config.linux.grouping, onNotificationClick))
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    const soundVolume = getSoundVolume(config, eventType)
    promises.push(playSound(eventType, customSoundPath, soundVolume))
  }

  if (isEventBellEnabled(config, eventType)) {
    promises.push(ringBell())
  }

  const minDuration = config.command?.minDuration
  const shouldSkipCommand =
    !isEventCommandEnabled(config, eventType) ||
    (typeof minDuration === "number" &&
      Number.isFinite(minDuration) &&
      minDuration > 0 &&
      typeof elapsedSeconds === "number" &&
      Number.isFinite(elapsedSeconds) &&
      elapsedSeconds < minDuration)

  if (!shouldSkipCommand) {
    runCommand(config, eventType, message, sessionTitle, agentName, projectName, timestamp, turn)
  }

  await Promise.allSettled(promises)
}

function getSessionIDFromEvent(event: unknown): string | null {
  const properties = getNestedRecord(event, "properties")
  return getStringField(properties, "sessionID")
}

interface SessionLifecycleInfo {
  id: string | null
  title: string | null
  parentID: string | null
}

function getSessionLifecycleInfo(event: unknown): SessionLifecycleInfo {
  const info = getNestedRecord(event, "properties", "info")
  return {
    id: getStringField(info, "id"),
    title: getStringField(info, "title"),
    parentID: getStringField(info, "parentID"),
  }
}

interface MessageUpdatedInfo {
  role: string | null
  sessionID: string | null
}

function getMessageUpdatedInfo(event: unknown): MessageUpdatedInfo {
  const info = getNestedRecord(event, "properties", "info")
  return {
    role: getStringField(info, "role"),
    sessionID: getStringField(info, "sessionID"),
  }
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
    const title = typeof response.data?.title === "string" ? response.data.title : null
    return {
      isChild: !!response.data?.parentID,
      title,
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

  // Fast path: if we already know this is a subagent from in-memory tracking,
  // skip the API call and go straight to subagent_complete
  if (subagentSessionIds.has(sessionID)) {
    await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, event, idleReceivedAtMs, null)
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

  // Update in-memory set now that we confirmed it's a child via API
  subagentSessionIds.add(sessionID)
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
  const shouldLookupSessionInfo = sessionID && !sessionTitle && (config.showSessionTitle || shouldResolveAgentNameForEvent(config, eventType))
  if (shouldLookupSessionInfo) {
    const info = await getSessionInfo(client, sessionID)
    sessionTitle = info.title
  }

  const agentName = extractAgentNameFromSessionTitle(sessionTitle)

  await handleEvent(config, eventType, projectName, elapsedSeconds, sessionTitle, sessionID, agentName)
}

export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  captureStartupWindowId()

  const clientEnv = process.env.OPENCODE_CLIENT
  if (clientEnv && clientEnv !== "cli") {
    const config = loadConfig()
    if (!config.enableOnDesktop) return {}
  }

  const getConfig = () => loadConfig()
  const projectName = directory ? basename(directory) : null

  // Fire client_connected after the plugin is fully initialized.
  // There is no SDK event that reliably signals client connection from a plugin's
  // perspective, so we approximate it with a short delay after plugin startup.
  // Config is read at fire-time so that any user overrides are respected.
  setTimeout(() => {
    void handleEvent(getConfig(), "client_connected", projectName, null)
  }, 100)

  return {
    event: async ({ event }) => {
      const config = getConfig()

      // Track subagent sessions from session lifecycle events
      if (event.type === "session.created") {
        const info = getSessionLifecycleInfo(event)
        if (info.parentID && info.id) {
          subagentSessionIds.add(info.id)
        } else {
          // Non-subagent session started
          await handleEvent(config, "session_started", projectName, null, info.title, info.id, null)
        }
      }

      if (event.type === "session.updated") {
        const info = getSessionLifecycleInfo(event)
        if (info.parentID && info.id) {
          subagentSessionIds.add(info.id)
        }
      }

      if (event.type === "session.deleted") {
        const info = getSessionLifecycleInfo(event)
        if (info.id) {
          subagentSessionIds.delete(info.id)
        }
      }

      if ((event as any).type === "permission.asked") {
        const sessionID = getSessionIDFromEvent(event)
        if (!shouldSuppressPermissionAlert(sessionID)) {
          await handleEventWithElapsedTime(client, config, "permission", projectName, event)
        }
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
        const eventType: EventType = event.properties.error?.name === "MessageAbortedError" ? "user_cancelled" : "error"
        let sessionTitle: string | null = null
        if (sessionID && config.showSessionTitle) {
          const info = await getSessionInfo(client, sessionID)
          sessionTitle = info.title
        }
        await handleEventWithElapsedTime(client, config, eventType, projectName, event, undefined, sessionTitle)
      }

      if (event.type === "message.updated") {
        const info = getMessageUpdatedInfo(event)
        if (info.role === "user") {
          const sessionID = info.sessionID
          // Only fire for non-subagent sessions
          if (!sessionID || !subagentSessionIds.has(sessionID)) {
            await handleEvent(config, "user_message", projectName, null, null, sessionID, null)
          }
        }
      }
    },
    "permission.ask": async () => {
      const config = getConfig()
      if (!shouldSuppressPermissionAlert(null)) {
        await handleEvent(config, "permission", projectName, null)
      }
    },
    "tool.execute.before": async (input) => {
      const config = getConfig()
      if (input.tool === "question") {
        await handleEvent(config, "question", projectName, null)
      }
      if (input.tool === "plan_exit") {
        await handleEvent(config, "plan_exit", projectName, null)
      }
    },
  }
}

export default NotifierPlugin
