import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath } from "./config"
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
  const notificationEnabled = isEventNotificationEnabled(config, eventType)
  const soundEnabled = isEventSoundEnabled(config, eventType)

  logEvent({
    action: "handleEvent",
    eventType,
    notificationEnabled,
    soundEnabled,
    message,
    customSoundPath,
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
    promises.push(playSound(eventType, customSoundPath))
  }

  await Promise.allSettled(promises)
}

export const NotifierPlugin: Plugin = async () => {
  const config = loadConfig()

  logEvent({
    action: "pluginInit",
    configLoaded: true,
    config: {
      sound: config.sound,
      notification: config.notification,
      timeout: config.timeout,
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
          await handleEvent(config, "complete")
        }
      }

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        await handleEvent(config, "error")
      }
    },
  }
}

export default NotifierPlugin
