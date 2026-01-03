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
  const DEBUG = process.env.OPENCODE_NOTIFIER_DEBUG === "true"

  return {
    event: async ({ event }) => {
      if (DEBUG) {
        console.log("[opencode-notifier] Event received:", event.type, JSON.stringify(event, null, 2))
      }

      // NEW: permission.asked replaces deprecated permission.updated
      if (event.type === "permission.asked") {
        if (DEBUG) console.log("[opencode-notifier] Triggering permission notification")
        await handleEvent(config, "permission")
      }

      // NEW: session.status replaces deprecated session.idle
      if (event.type === "session.status") {
        const status = (event as any).properties?.status
        if (DEBUG) console.log("[opencode-notifier] Session status:", status)
        if (status?.type === "idle") {
          if (DEBUG) console.log("[opencode-notifier] Triggering complete notification")
          await handleEvent(config, "complete")
        }
      }

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        if (DEBUG) console.log("[opencode-notifier] Triggering error notification")
        await handleEvent(config, "error")
      }
    },
  }
}

export default NotifierPlugin
