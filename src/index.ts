import type { Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import type { Context as OpenCodeContext, Plugin as OpenCodePlugin } from "@opencode/plugin/promise/plugin"
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

export function isCLIClient(clientEnv?: string): boolean {
  return !clientEnv || clientEnv === "cli"
}

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
const cleanupInterval = setInterval(() => {
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
cleanupInterval.unref()

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

  const notificationEnabled = isEventNotificationEnabled(config, eventType)
  if (notificationEnabled) {
    const title = getNotificationTitle(config, projectName)
    const iconPath = getIconPath(config)
    const onNotificationClick = isKDEJumpBackSupported() ? () => void focusTerminal() : undefined
    promises.push(sendNotification(title, message, config.timeout, iconPath, config.notificationSystem, config.linux.grouping, onNotificationClick, config.windows.appID))
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    const ghosttyOnMac = process.platform === "darwin" && config.notificationSystem === "ghostty" && notificationEnabled && config.suppressGhosttySound
    if (!ghosttyOnMac) {
      const soundVolume = getSoundVolume(config, eventType)
      promises.push(playSound(eventType, customSoundPath, soundVolume))
    }
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

interface SessionInfo {
  isChild: boolean
  title: string | null
}

/**
 * Minimal session-reader surface shared by the V1 and V2 adapters. Each adapter
 * translates its own client/context request shapes into these two reads.
 */
export interface NotifierSessionClient {
  /** Epoch-ms timestamp of the newest user message in the session, or null when unknown. */
  lastUserMessageAt(sessionID: string): Promise<number | null>
  /** Session metadata used for subagent detection and title interpolation. */
  sessionInfo(sessionID: string): Promise<SessionInfo>
}

async function getElapsedSinceLastPrompt(
  client: NotifierSessionClient,
  sessionID: string,
  nowMs: number = Date.now()
): Promise<number | null> {
  try {
    const lastUserMessageTime = await client.lastUserMessageAt(sessionID)

    if (lastUserMessageTime !== null) {
      return (nowMs - lastUserMessageTime) / 1000
    }
  } catch {
  }

  return null
}

async function getSessionInfo(
  client: NotifierSessionClient,
  sessionID: string
): Promise<SessionInfo> {
  try {
    return await client.sessionInfo(sessionID)
  } catch {
    return { isChild: false, title: null }
  }
}

async function processSessionIdle(
  client: NotifierSessionClient,
  config: NotifierConfig,
  projectName: string | null,
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
    await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, sessionID, idleReceivedAtMs, null)
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
    await handleEventWithElapsedTime(client, config, "complete", projectName, sessionID, idleReceivedAtMs, sessionInfo.title)
    return
  }

  // Update in-memory set now that we confirmed it's a child via API
  subagentSessionIds.add(sessionID)
  await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, sessionID, idleReceivedAtMs, sessionInfo.title)
}

function scheduleSessionIdle(
  client: NotifierSessionClient,
  config: NotifierConfig,
  projectName: string | null,
  sessionID: string
): void {
  clearPendingIdleTimer(sessionID)
  const sequence = bumpSessionIdleSequence(sessionID)
  const idleReceivedAtMs = Date.now()

  const timer = setTimeout(() => {
    pendingIdleTimers.delete(sessionID)
    void processSessionIdle(client, config, projectName, sessionID, sequence, idleReceivedAtMs).catch(() => undefined)
  }, IDLE_COMPLETE_DELAY_MS)

  pendingIdleTimers.set(sessionID, timer)
}

async function handleEventWithElapsedTime(
  client: NotifierSessionClient,
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  sessionID: string | null,
  elapsedReferenceNowMs?: number,
  preloadedSessionTitle?: string | null
): Promise<void> {
  const commandMinDuration = config.command?.minDuration
  const shouldLookupElapsedForCommand =
    !!config.command?.enabled &&
    typeof config.command?.path === "string" &&
    config.command.path.length > 0 &&
    typeof commandMinDuration === "number" &&
    Number.isFinite(commandMinDuration) &&
    commandMinDuration > 0

  const shouldLookupElapsedForNotification =
    typeof config.minDuration === "number" &&
    Number.isFinite(config.minDuration) &&
    config.minDuration > 0

  const shouldLookupElapsed = shouldLookupElapsedForCommand || shouldLookupElapsedForNotification

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

/**
 * Client-version-agnostic description of the events this plugin reacts to.
 * The V1 and V2 adapters translate their own event envelopes into these.
 */
export type NotifierEvent =
  | { type: "session.created"; sessionID: string | null; parentID: string | null; title: string | null }
  | { type: "session.updated"; sessionID: string | null; parentID: string | null }
  | { type: "session.deleted"; sessionID: string | null }
  | { type: "permission.asked"; sessionID: string | null }
  | { type: "permission.ask" }
  | { type: "session.idle"; sessionID: string | null }
  | { type: "session.busy"; sessionID: string }
  | { type: "session.error"; sessionID: string | null; userCancelled: boolean }
  | { type: "message.user"; sessionID: string | null }
  | { type: "tool.before"; tool: string }

interface NotifierRuntime {
  dispatch(event: NotifierEvent): Promise<void>
}

/**
 * Builds the shared notification behavior once, independent of the client
 * version. Returns null when the plugin is disabled for this client.
 */
function createNotifierRuntime(
  client: NotifierSessionClient,
  directory: string | null,
  clientEnv: string | undefined
): NotifierRuntime | null {
  captureStartupWindowId()

  if (clientEnv && clientEnv !== "cli") {
    const config = loadConfig()
    if (!config.enableOnDesktop) return null
  }

  const getConfig = () => loadConfig()
  const projectName = directory ? (getConfig().showFullPath ? directory : basename(directory)) : null
  const isCLI = isCLIClient(clientEnv)

  // Fire client_connected after the plugin is fully initialized.
  // There is no SDK event that reliably signals client connection from a plugin's
  // perspective, so we approximate it with a short delay after plugin startup.
  // Config is read at fire-time so that any user overrides are respected.
  // CLI sessions skip the delay since the process may exit before it fires.
  if (isCLI) {
    void handleEvent(getConfig(), "client_connected", projectName, null)
  } else {
    setTimeout(() => {
      void handleEvent(getConfig(), "client_connected", projectName, null)
    }, 100)
  }

  const dispatch = async (event: NotifierEvent): Promise<void> => {
    const config = getConfig()

    switch (event.type) {
      case "session.created": {
        // Track subagent sessions from session lifecycle events
        if (event.parentID && event.sessionID) {
          subagentSessionIds.add(event.sessionID)
        } else {
          await handleEvent(config, "session_started", projectName, null, event.title, event.sessionID, null)
        }
        return
      }

      case "session.updated": {
        if (event.parentID && event.sessionID) {
          subagentSessionIds.add(event.sessionID)
        }
        return
      }

      case "session.deleted": {
        if (event.sessionID) {
          subagentSessionIds.delete(event.sessionID)
        }
        return
      }

      case "permission.asked": {
        if (!shouldSuppressPermissionAlert(event.sessionID)) {
          await handleEventWithElapsedTime(client, config, "permission", projectName, event.sessionID)
        }
        return
      }

      // Used only by the V1 `permission.ask` hook, which fires exactly when the
      // user is prompted. V2 does not emit this; it reports the same moment
      // through the `permission.asked` event.
      case "permission.ask": {
        if (!shouldSuppressPermissionAlert(null)) {
          await handleEvent(config, "permission", projectName, null)
        }
        return
      }

      case "session.idle": {
        const sessionID = event.sessionID
        if (sessionID) {
          if (isCLI) {
            // CLI sessions (opencode run) exit soon after going idle.
            // Process completion directly to avoid losing the notification
            // when the process terminates before the debounce timer fires.
            const idleReceivedAtMs = Date.now()
            const sequence = bumpSessionIdleSequence(sessionID)
            await processSessionIdle(client, config, projectName, sessionID, sequence, idleReceivedAtMs)
          } else {
            scheduleSessionIdle(client, config, projectName, sessionID)
          }
        } else {
          await handleEventWithElapsedTime(client, config, "complete", projectName, null)
        }
        return
      }

      case "session.busy": {
        markSessionBusy(event.sessionID)
        return
      }

      case "session.error": {
        markSessionError(event.sessionID)
        const eventType: EventType = event.userCancelled ? "user_cancelled" : "error"
        let sessionTitle: string | null = null
        if (event.sessionID && config.showSessionTitle) {
          const info = await getSessionInfo(client, event.sessionID)
          sessionTitle = info.title
        }
        await handleEventWithElapsedTime(client, config, eventType, projectName, event.sessionID, undefined, sessionTitle)
        return
      }

      case "message.user": {
        const sessionID = event.sessionID
        // Only fire for non-subagent sessions
        if (!sessionID || !subagentSessionIds.has(sessionID)) {
          await handleEvent(config, "user_message", projectName, null, null, sessionID, null)
        }
        return
      }

      case "tool.before": {
        if (event.tool === "question") {
          await handleEvent(config, "question", projectName, null)
        }
        if (event.tool === "plan_exit") {
          await handleEvent(config, "plan_exit", projectName, null)
        }
        return
      }
    }
  }

  return { dispatch }
}

/** Translates V1 (OpenCode 1.x) event envelopes into normalized notifier events. */
export function normalizeV1Event(event: unknown): NotifierEvent[] {
  const events: NotifierEvent[] = []
  const type = getStringField(asRecord(event), "type")

  if (type === "session.created") {
    const info = getSessionLifecycleInfo(event)
    events.push({ type: "session.created", sessionID: info.id, parentID: info.parentID, title: info.title })
  }

  if (type === "session.updated") {
    const info = getSessionLifecycleInfo(event)
    events.push({ type: "session.updated", sessionID: info.id, parentID: info.parentID })
  }

  if (type === "session.deleted") {
    const info = getSessionLifecycleInfo(event)
    events.push({ type: "session.deleted", sessionID: info.id })
  }

  if (type === "permission.asked") {
    events.push({ type: "permission.asked", sessionID: getSessionIDFromEvent(event) })
  }

  if (type === "session.idle") {
    events.push({ type: "session.idle", sessionID: getSessionIDFromEvent(event) })
  }

  if (type === "session.status") {
    const status = getNestedRecord(event, "properties", "status")
    const sessionID = getStringField(getNestedRecord(event, "properties"), "sessionID")
    if (getStringField(status, "type") === "busy" && sessionID) {
      events.push({ type: "session.busy", sessionID })
    }
  }

  if (type === "session.error") {
    const error = getNestedRecord(event, "properties", "error")
    events.push({
      type: "session.error",
      sessionID: getSessionIDFromEvent(event),
      userCancelled: getStringField(error, "name") === "MessageAbortedError",
    })
  }

  if (type === "message.updated") {
    const info = getMessageUpdatedInfo(event)
    if (info.role === "user") {
      events.push({ type: "message.user", sessionID: info.sessionID })
    }
  }

  return events
}

/** Translates V2 (OpenCode 2.x) event envelopes into normalized notifier events. */
export function normalizeV2Event(event: unknown): NotifierEvent[] {
  const events: NotifierEvent[] = []
  const record = asRecord(event)
  const type = getStringField(record, "type")
  const data = getNestedRecord(event, "data") ?? {}

  if (type === "session.created") {
    events.push({
      type: "session.created",
      sessionID: getStringField(data, "sessionID"),
      parentID: getStringField(data, "parentID"),
      title: getStringField(data, "title"),
    })
  }

  if (type === "session.deleted") {
    events.push({ type: "session.deleted", sessionID: getStringField(data, "sessionID") })
  }

  if (type === "permission.asked") {
    events.push({ type: "permission.asked", sessionID: getStringField(data, "sessionID") })
  }

  if (type === "session.idle") {
    events.push({ type: "session.idle", sessionID: getStringField(data, "sessionID") })
  }

  if (type === "session.status") {
    const status = getNestedRecord(event, "data", "status")
    const sessionID = getStringField(data, "sessionID")
    if (getStringField(status, "type") === "busy" && sessionID) {
      events.push({ type: "session.busy", sessionID })
    }
  }

  if (type === "session.execution.failed") {
    events.push({ type: "session.error", sessionID: getStringField(data, "sessionID"), userCancelled: false })
  }

  if (type === "session.execution.interrupted") {
    events.push({
      type: "session.error",
      sessionID: getStringField(data, "sessionID"),
      userCancelled: getStringField(data, "reason") === "user",
    })
  }

  if (type === "session.inbox.enqueued") {
    const item = getNestedRecord(event, "data", "item")
    if (getStringField(item, "type") === "user") {
      events.push({ type: "message.user", sessionID: getStringField(data, "sessionID") })
    }
  }

  return events
}

/** V1 client reads via the legacy `@opencode-ai/plugin` client. */
function createV1SessionClient(client: PluginInput["client"]): NotifierSessionClient {
  return {
    async lastUserMessageAt(sessionID: string): Promise<number | null> {
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

      return lastUserMessageTime
    },
    async sessionInfo(sessionID: string): Promise<SessionInfo> {
      const response = await client.session.get({ path: { id: sessionID } })
      return {
        isChild: !!response.data?.parentID,
        title: typeof response.data?.title === "string" ? response.data.title : null,
      }
    },
  }
}

/** V2 client reads via the plugin context domain methods. */
function createV2SessionClient(ctx: OpenCodeContext): NotifierSessionClient {
  return {
    async lastUserMessageAt(sessionID: string): Promise<number | null> {
      const messages = await ctx.session.context({ sessionID })

      let lastUserMessageTime: number | null = null
      for (const msg of messages ?? []) {
        if (msg.type === "user" && typeof msg.time?.created === "number") {
          if (lastUserMessageTime === null || msg.time.created > lastUserMessageTime) {
            lastUserMessageTime = msg.time.created
          }
        }
      }

      return lastUserMessageTime
    },
    async sessionInfo(sessionID: string): Promise<SessionInfo> {
      const info = await ctx.session.get({ sessionID })
      return {
        isChild: !!info?.parentID,
        title: typeof info?.title === "string" ? info.title : null,
      }
    },
  }
}

/**
 * V1 (OpenCode 1.x) entrypoint. Retained so the package keeps working for
 * existing users while V2 support rolls out.
 */
export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  const runtime = createNotifierRuntime(createV1SessionClient(client), directory ?? null, process.env.OPENCODE_CLIENT)
  if (!runtime) return {}

  return {
    event: async ({ event }) => {
      for (const normalized of normalizeV1Event(event)) {
        await runtime.dispatch(normalized)
      }
    },
    "permission.ask": async () => {
      await runtime.dispatch({ type: "permission.ask" })
    },
    "tool.execute.before": async (input) => {
      await runtime.dispatch({ type: "tool.before", tool: input.tool })
    },
  }
}

/**
 * V2 (OpenCode 2.x) entrypoint. V1 plugin implementations do not run in V2, so
 * this registers the same behavior through the V2 setup/context API.
 */
export const NotifierPluginV2: OpenCodePlugin = {
  id: "opencode-notifier",
  async setup(ctx) {
    const runtime = createNotifierRuntime(
      createV2SessionClient(ctx),
      ctx.location?.directory ?? null,
      process.env.OPENCODE_CLIENT
    )
    if (!runtime) return

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          for (const normalized of normalizeV2Event(event)) {
            await runtime.dispatch(normalized)
          }
        }
      } catch {
        // The subscription is aborted during plugin cleanup.
      }
    })()

    // V1 exposed `permission.ask` and `tool.execute.before` hooks. V2 signals a
    // pending prompt through the `permission.asked` event, which the subscription
    // above already handles. The `evaluate` hook is intentionally not used: it
    // runs for every permission evaluation, including auto-approved requests,
    // which would notify when no prompt was shown.
    await ctx.tool.hook("execute.before", (event) => {
      void runtime.dispatch({ type: "tool.before", tool: event.tool })
    })

    return () => controller.abort()
  },
}

// A single package can expose both entrypoints: V1 calls `server()`, V2 calls
// `setup()`. The default export needs `id` plus one of `setup`/`effect` for V2
// and `server` for V1.
const pluginModule = {
  id: "opencode-notifier",
  setup: NotifierPluginV2.setup,
  server: NotifierPlugin,
}

export default pluginModule as typeof pluginModule & PluginModule
