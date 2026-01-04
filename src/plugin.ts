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

// Time provider for testing
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
  // Replace template variables
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

// Exported for testing - allows config injection
export async function createNotifierPlugin(config?: NotifierConfig, pluginInput?: PluginInput) {
  const pluginConfig = config ?? loadConfig()
  let lastErrorTime = -1
  let lastIdleTime = -1
  let pendingIdleNotification: (() => void) | null = null // Cancellation handle for idle notification

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

      // Determine session title and ID
      const sessionID = event.properties?.sessionID as string | undefined
      let sessionTitle = "OpenCode"
      let parentID: string | undefined

      if (sessionID) {
        if (pluginInput) {
          try {
            const sessionResponse = await pluginInput.client.session.get({ path: { id: sessionID } })
            const session = sessionResponse.data
            if (session) {
              sessionTitle = session.title || "OpenCode"
              parentID = session.parentID
            }
          } catch (error) {
            logEvent({
              action: "sessionLookupError",
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
            // Optionally notify user via TUI
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

      // NEW: permission.asked replaces deprecated permission.updated
      if (event.type === "permission.asked") {
        await handleEvent(pluginConfig, "permission", sessionTitle)
      }

      // NEW: session.status replaces deprecated session.idle
      if (event.type === "session.status") {
        const typedEvent = event as EventWithProperties
        const status = typedEvent.properties?.status
        if (status?.type === "idle") {
          const now = timeProvider.now()

          // Skip idle if it's right after an error (error came first)
          if (lastErrorTime >= 0 && now - lastErrorTime < RACE_CONDITION_DEBOUNCE_MS) {
            logEvent({
              action: "skipIdleAfterError",
              timeSinceError: now - lastErrorTime,
              reason: "Idle event following error - skipping both notifications (cancellation)",
            })
            return
          }

          // Determine event type: subagent or complete
          let eventType: EventType = "complete"

          // Use 'subagent' event type if it has a parent session
          if (parentID) {
            eventType = "subagent"
            logEvent({
              action: "subagentDetected",
              sessionID,
              parentID,
              reason: "Session has a parentID, routing to subagent config",
            })
          }

          // Record idle time FIRST for potential future error debouncing
          lastIdleTime = now

          // Delay idle notification to detect cancellation (error coming right after)
          let cancelled = false
          pendingIdleNotification = () => {
            cancelled = true
          }

          await new Promise((resolve) => setTimeout(resolve, 150))

          // Check if error cancelled this notification
          if (cancelled) {
            pendingIdleNotification = null
            return
          }

          // Check if error happened while we were waiting
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

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        const now = timeProvider.now()
        
        // Cancel pending idle notification if one is waiting
        if (pendingIdleNotification) {
          logEvent({
            action: "cancelPendingIdle",
            reason: "Error occurred while idle notification was pending (cancellation)",
          })
          pendingIdleNotification()
          pendingIdleNotification = null
          // Don't send error notification either - it's a cancellation
          return
        }

        // Skip error if idle just happened (idle came first but already sent notification)
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

// Main plugin factory - exported for tests, used by index.ts for production
export async function createNotifierPluginInstance(pluginInput?: PluginInput) {
  return createNotifierPlugin(undefined, pluginInput)
}
