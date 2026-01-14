import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { runCommand } from "./command"

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  elapsedSeconds?: number | null
): Promise<void> {
  const promises: Promise<void>[] = []

  const message = getMessage(config, eventType)

  if (isEventNotificationEnabled(config, eventType)) {
    promises.push(sendNotification(message, config.timeout))
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    promises.push(playSound(eventType, customSoundPath))
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
    runCommand(config, eventType, message)
  }

  await Promise.allSettled(promises)
}

function getSessionIDFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null
  }

  const anyEvent = event as any
  const candidates = [
    anyEvent?.properties?.sessionID,
    anyEvent?.properties?.sessionId,
    anyEvent?.sessionID,
    anyEvent?.sessionId,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

async function getElapsedPromptExecutionSeconds(
  client: PluginInput["client"],
  sessionID: string
): Promise<number | null> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    const createdAt = response.data?.time?.created
    const updatedAt = response.data?.time?.updated

    if (
      typeof createdAt === "number" &&
      Number.isFinite(createdAt) &&
      typeof updatedAt === "number" &&
      Number.isFinite(updatedAt) &&
      updatedAt >= createdAt
    ) {
      // Duration in seconds (timestamps are in milliseconds)
      return (updatedAt - createdAt) / 1000
    }
  } catch {
    // Best-effort: unknown duration should not cause gating.
  }

  return null
}

async function isChildSession(
  client: PluginInput["client"],
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.get({ path: { id: sessionID } })
    const parentID = response.data?.parentID

    // Return true if parentID exists (it's a child session)
    // Return false if parentID doesn't exist (it's a main session)
    return !!parentID
  } catch {
    // Best-effort: if lookup fails, treat as primary session
    return false
  }
}

async function getElapsedPromptExecutionSecondsFromEvent(
  client: PluginInput["client"],
  event: unknown
): Promise<number | null> {
  const sessionID = getSessionIDFromEvent(event)
  if (!sessionID) {
    return null
  }

  return getElapsedPromptExecutionSeconds(client, sessionID)
}

async function handleEventForOpenCodeEvent(
  client: PluginInput["client"],
  config: NotifierConfig,
  eventType: EventType,
  event: unknown
): Promise<void> {
  const minDuration = config.command?.minDuration
  const shouldLookupElapsed =
    !!config.command?.enabled &&
    typeof config.command?.path === "string" &&
    config.command.path.length > 0 &&
    typeof minDuration === "number" &&
    Number.isFinite(minDuration) &&
    minDuration > 0

  const elapsedSeconds = shouldLookupElapsed ? await getElapsedPromptExecutionSecondsFromEvent(client, event) : null

  await handleEvent(config, eventType, elapsedSeconds)
}

export const NotifierPlugin: Plugin = async ({ client }) => {
  const config = loadConfig()

  return {
    event: async ({ event }) => {
      // @deprecated: Old permission system (OpenCode v1.0.223 and earlier)
      // Uses permission.updated event - will be removed in future version
      if (event.type === "permission.updated") {
        await handleEventForOpenCodeEvent(client, config, "permission", event)
      }

      // New permission system (OpenCode v1.0.224+)
      // Uses permission.asked event
      if ((event as any).type === "permission.asked") {
        await handleEventForOpenCodeEvent(client, config, "permission", event)
      }

      if (event.type === "session.idle") {
        const sessionID = getSessionIDFromEvent(event)
        if (sessionID) {
          const isChild = await isChildSession(client, sessionID)
          if (!isChild) {
            await handleEventForOpenCodeEvent(client, config, "complete", event)
          } else {
            await handleEventForOpenCodeEvent(client, config, "subagent_complete", event)
          }
        }
      }

      if (event.type === "session.error") {
        await handleEventForOpenCodeEvent(client, config, "error", event)
      }
    },
    "permission.ask": async () => {
      await handleEvent(config, "permission")
    },
  }
}

export default NotifierPlugin
