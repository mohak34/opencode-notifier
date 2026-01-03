// Plugin implementation - all exports here are for testing only
import type { PluginInput } from "@opencode-ai/plugin"

import {
  getImagePath,
  getMessage,
  getSoundPath,
  getVolume,
  isEventNotificationEnabled,
  isEventSoundEnabled,
  loadConfig,
  RACE_CONDITION_DEBOUNCE_MS,
} from "./config"
import type { EventType, NotifierConfig } from "./config"
import { logEvent } from "./debug-logging"
import { sendNotification } from "./notify"
import { sessionCache } from "./session-cache"
import { playSound } from "./sound"

// Exported for testing
export interface EventWithProperties {
  type: string
  properties?: {
    status?: {
      type: string
    }
    info?: {
      id: string
      title?: string
      parentID?: string
    }
    sessionID?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export const timeProvider = {
  now: (): number => Date.now(),
}

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  sessionTitle: string = "OpenCode"
): Promise<void> {
  const promises: Promise<void>[] = []

  let message = getMessage(config, eventType)
  message = message.replace(/\{\{title\}\}/g, sessionTitle)

  const customSoundPath = getSoundPath(config, eventType)
  const customImagePath = getImagePath(config, eventType)
  const volume = getVolume(config)
  const notificationEnabled = isEventNotificationEnabled(config, eventType)
  const soundEnabled = isEventSoundEnabled(config, eventType)

  logEvent({
    action: "handleEvent",
    eventType,
    notificationEnabled,
    soundEnabled,
    message,
    sessionTitle,
    customSoundPath,
    volume,
    config: {
      events: config.events,
      messages: config.messages,
      sounds: config.sounds,
    },
  })

  if (notificationEnabled) {
    promises.push(sendNotification(message, config.timeout, customImagePath, sessionTitle))
  }

  if (soundEnabled) {
    promises.push(playSound(eventType, customSoundPath, volume))
  }

  await Promise.allSettled(promises)
}

export async function createNotifierPlugin(config?: NotifierConfig, pluginInput?: PluginInput) {
  const pluginConfig = config ?? loadConfig()
  let lastErrorTime = -1
  let lastIdleTime = -1
  let pendingIdleNotification: (() => void) | null = null

  logEvent({
    action: "pluginInit",
    configLoaded: true,
    config: {
      sound: pluginConfig.sound,
      notification: pluginConfig.notification,
      timeout: pluginConfig.timeout,
      volume: pluginConfig.volume,
      events: pluginConfig.events,
      messages: pluginConfig.messages,
      sounds: pluginConfig.sounds,
    },
  })

  return {
    event: async ({ event }: { event: EventWithProperties }) => {
      logEvent({
        action: "eventReceived",
        eventType: event.type,
        event: event,
      })

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = event.properties?.info
        if (info?.id && info?.title) {
          sessionCache.set(info.id, {
            title: info.title,
            parentID: info.parentID,
          })
        }
      }

      const sessionID = event.properties?.sessionID as string | undefined
      let sessionTitle = "OpenCode"
      let parentID: string | undefined

      if (sessionID) {
        const cached = sessionCache.get(sessionID)
        if (cached) {
          sessionTitle = cached.title
          parentID = cached.parentID
        } else if (pluginInput) {
          try {
            const sessionResponse = await pluginInput.client.session.get({ path: { id: sessionID } })
            const session = sessionResponse.data
            if (session) {
              sessionTitle = session.title || "OpenCode"
              parentID = session.parentID
              sessionCache.set(sessionID, { title: sessionTitle, parentID })
            }
          } catch (error) {
            logEvent({
              action: "sessionLookupError",
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
            if (pluginInput.client.tui) {
              await pluginInput.client.tui.showToast({
                body: {
                  message: `Notifier failed to lookup session: ${sessionID}`,
                  variant: "warning",
                  duration: 3000,
                },
              }).catch(() => {})
            }
          }
        }
      }

      if (event.type === "permission.asked") {
        await handleEvent(pluginConfig, "permission", sessionTitle)
      }

      if (event.type === "session.status") {
        const typedEvent = event as EventWithProperties
        const status = typedEvent.properties?.status
        if (status?.type === "idle") {
          const now = timeProvider.now()

          if (lastErrorTime >= 0 && now - lastErrorTime < RACE_CONDITION_DEBOUNCE_MS) {
            logEvent({
              action: "skipIdleAfterError",
              timeSinceError: now - lastErrorTime,
              reason: "Idle event following error - skipping both notifications (cancellation)",
            })
            return
          }

          let eventType: EventType = "complete"

          if (parentID) {
            eventType = "subagent"
            logEvent({
              action: "subagentDetected",
              sessionID,
              parentID,
              reason: "Session has a parentID, routing to subagent config",
            })
          }

          lastIdleTime = now

          let cancelled = false
          pendingIdleNotification = () => {
            cancelled = true
          }

          await new Promise((resolve) => setTimeout(resolve, 150))

          if (cancelled) {
            pendingIdleNotification = null
            return
          }

          const afterDelay = timeProvider.now()
          if (lastErrorTime >= 0 && afterDelay - lastErrorTime < RACE_CONDITION_DEBOUNCE_MS) {
            logEvent({
              action: "skipIdleAfterError",
              timeSinceError: afterDelay - lastErrorTime,
              reason: "Idle notification cancelled - error detected during delay (cancellation)",
            })
            pendingIdleNotification = null
            return
          }

          pendingIdleNotification = null
          await handleEvent(pluginConfig, eventType, sessionTitle)
        }
      }

      if (event.type === "session.error") {
        const now = timeProvider.now()
        
        if (pendingIdleNotification) {
          logEvent({
            action: "cancelPendingIdle",
            reason: "Error occurred while idle notification was pending (cancellation)",
          })
          pendingIdleNotification()
          pendingIdleNotification = null
          return
        }

        if (lastIdleTime >= 0 && now - lastIdleTime < RACE_CONDITION_DEBOUNCE_MS) {
          logEvent({
            action: "skipErrorAfterIdle",
            timeSinceIdle: now - lastIdleTime,
            reason: "Error notification skipped - idle just happened (cancellation)",
          })
          return
        }
        
        lastErrorTime = now
        await handleEvent(pluginConfig, "error", sessionTitle)
      }
    },
  }
}

export async function createNotifierPluginInstance(pluginInput?: PluginInput) {
  return createNotifierPlugin(undefined, pluginInput)
}
