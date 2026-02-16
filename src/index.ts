import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { basename } from "path"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath, getIconPath, interpolateMessage } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { runCommand } from "./command"

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
    promises.push(sendNotification(title, message, config.timeout, iconPath, config.notificationSystem))
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
    runCommand(config, eventType, message, sessionTitle)
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

async function getElapsedSinceLastPrompt(
  client: PluginInput["client"],
  sessionID: string
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
      return (Date.now() - lastUserMessageTime) / 1000
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

async function handleEventWithElapsedTime(
  client: PluginInput["client"],
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  event: unknown,
  preloadedSessionTitle?: string | null
): Promise<void> {
  const sessionID = getSessionIDFromEvent(event)

  let elapsedSeconds: number | null = null
  let sessionTitle: string | null = preloadedSessionTitle ?? null

  if (sessionID) {
    const minDuration = config.command?.minDuration
    const shouldLookupElapsed =
      !!config.command?.enabled &&
      typeof config.command?.path === "string" &&
      config.command.path.length > 0 &&
      typeof minDuration === "number" &&
      Number.isFinite(minDuration) &&
      minDuration > 0

    if (shouldLookupElapsed) {
      elapsedSeconds = await getElapsedSinceLastPrompt(client, sessionID)
    }

    // Look up session title if not already provided and feature is enabled
    if (!sessionTitle && config.showSessionTitle) {
      const info = await getSessionInfo(client, sessionID)
      sessionTitle = info.title
    }
  }

  await handleEvent(config, eventType, projectName, elapsedSeconds, sessionTitle)
}

export const NotifierPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig()
  const projectName = directory ? basename(directory) : null

  return {
    event: async ({ event }) => {
      if (event.type === "permission.updated") {
        await handleEventWithElapsedTime(client, config, "permission", projectName, event)
      }

      if ((event as any).type === "permission.asked") {
        await handleEventWithElapsedTime(client, config, "permission", projectName, event)
      }

      if (event.type === "session.idle") {
        const sessionID = getSessionIDFromEvent(event)
        if (sessionID) {
          const sessionInfo = await getSessionInfo(client, sessionID)
          if (!sessionInfo.isChild) {
            await handleEventWithElapsedTime(client, config, "complete", projectName, event, sessionInfo.title)
          } else {
            await handleEventWithElapsedTime(client, config, "subagent_complete", projectName, event, sessionInfo.title)
          }
        } else {
          await handleEventWithElapsedTime(client, config, "complete", projectName, event)
        }
      }

      if (event.type === "session.error") {
        await handleEventWithElapsedTime(client, config, "error", projectName, event)
      }
    },
    "permission.ask": async () => {
      await handleEvent(config, "permission", projectName, null)
    },
    "tool.execute.before": async (input) => {
      if (input.tool === "question") {
        await handleEvent(config, "question", projectName, null)
      }
    },
  }
}

export default NotifierPlugin
