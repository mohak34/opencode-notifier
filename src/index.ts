import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath, getVolume, getImagePath } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { logEvent } from "./debug-logging"

// Exported for testing
export interface EventWithProperties {
  type: string
  properties?: {
    status?: {
      type: string
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

// Time provider for testing
export const timeProvider = {
  now: (): number => Date.now()
}

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType
): Promise<void> {
  const promises: Promise<void>[] = []

  const message = getMessage(config, eventType)
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
    customSoundPath,
    volume,
    config: {
      events: config.events,
      messages: config.messages,
      sounds: config.sounds
    }
  })

  if (notificationEnabled) {
    promises.push(sendNotification(message, config.timeout, customImagePath))
  }

  if (soundEnabled) {
    promises.push(playSound(eventType, customSoundPath, volume))
  }

  await Promise.allSettled(promises)
}

// Exported for testing - allows config injection
export async function createNotifierPlugin(config?: NotifierConfig) {
  const pluginConfig = config ?? loadConfig()
  let lastErrorTime = 0
  const ERROR_IDLE_DEBOUNCE_MS = 2000 // Skip idle events within 2s of error

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
      sounds: pluginConfig.sounds
    }
  })

  return {
    event: async ({ event }) => {
      logEvent({
        action: "eventReceived",
        eventType: event.type,
        event: event
      })

      // NEW: permission.asked replaces deprecated permission.updated
      if (event.type === "permission.asked") {
        await handleEvent(pluginConfig, "permission")
      }

      // NEW: session.status replaces deprecated session.idle
      if (event.type === "session.status") {
        const typedEvent = event as EventWithProperties
        const status = typedEvent.properties?.status
        if (status?.type === "idle") {
          // Skip idle if it's right after an error
          const now = timeProvider.now()
          if (now - lastErrorTime < ERROR_IDLE_DEBOUNCE_MS) {
            logEvent({
              action: "skipIdleAfterError",
              timeSinceError: now - lastErrorTime,
              reason: "Idle event following error - skipping to avoid double notification"
            })
            return
          }
          await handleEvent(pluginConfig, "complete")
        }
      }

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        lastErrorTime = timeProvider.now()
        await handleEvent(pluginConfig, "error")
      }
    },
  }
}

export const NotifierPlugin: Plugin = async () => {
  return createNotifierPlugin()
}

export default NotifierPlugin
