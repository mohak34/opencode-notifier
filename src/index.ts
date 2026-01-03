import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath, getVolume } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"
import { logEvent } from "./debug-logging"

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType
): Promise<void> {
  const promises: Promise<void>[] = []

  const message = getMessage(config, eventType)
  const customSoundPath = getSoundPath(config, eventType)
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
    promises.push(sendNotification(message, config.timeout))
  }

  if (soundEnabled) {
    promises.push(playSound(eventType, customSoundPath, volume))
  }

  await Promise.allSettled(promises)
}

export const NotifierPlugin: Plugin = async () => {
  const config = loadConfig()
  let lastErrorTime = 0
  const ERROR_IDLE_DEBOUNCE_MS = 2000 // Skip idle events within 2s of error

  logEvent({
    action: "pluginInit",
    configLoaded: true,
    config: {
      sound: config.sound,
      notification: config.notification,
      timeout: config.timeout,
      volume: config.volume,
      events: config.events,
      messages: config.messages,
      sounds: config.sounds
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
        await handleEvent(config, "permission")
      }

      // NEW: session.status replaces deprecated session.idle
      if (event.type === "session.status") {
        const status = (event as any).properties?.status
        if (status?.type === "idle") {
          // Skip idle if it's right after an error
          const now = Date.now()
          if (now - lastErrorTime < ERROR_IDLE_DEBOUNCE_MS) {
            logEvent({
              action: "skipIdleAfterError",
              timeSinceError: now - lastErrorTime,
              reason: "Idle event following error - skipping to avoid double notification"
            })
            return
          }
          await handleEvent(config, "complete")
        }
      }

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        lastErrorTime = Date.now()
        await handleEvent(config, "error")
      }
    },
  }
}

export default NotifierPlugin
