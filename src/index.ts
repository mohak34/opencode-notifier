import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, isEventSoundEnabled, isEventNotificationEnabled, getMessage, getSoundPath } from "./config"
import type { EventType, NotifierConfig } from "./config"
import { sendNotification } from "./notify"
import { playSound } from "./sound"

async function handleEvent(
  config: NotifierConfig,
  eventType: EventType
): Promise<void> {
  const promises: Promise<void>[] = []

  if (isEventNotificationEnabled(config, eventType)) {
    const message = getMessage(config, eventType)
    promises.push(sendNotification(message, config.timeout))
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    promises.push(playSound(eventType, customSoundPath))
  }

  await Promise.allSettled(promises)
}

export const NotifierPlugin: Plugin = async () => {
  const config = loadConfig()

  return {
    event: async ({ event }) => {
      if (event.type === "permission.updated") {
        await handleEvent(config, "permission")
      }

      if (event.type === "session.idle") {
        await handleEvent(config, "complete")
      }

      if (event.type === "session.error") {
        await handleEvent(config, "error")
      }
    },
  }
}

export default NotifierPlugin
