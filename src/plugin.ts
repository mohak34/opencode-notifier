// Plugin implementation - all exports here are for testing only
import type { PluginInput } from "@opencode-ai/plugin"

import { logEvent } from "./debug-logging"
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
import { sendNotification } from "./notify"
import { playSound } from "./sound"

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
      sounds: config.sounds,
    },
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
export async function createNotifierPlugin(config?: NotifierConfig, pluginInput?: PluginInput) {
  const pluginConfig = config ?? loadConfig()
  let lastErrorTime = -1
  let lastIdleTime = -1

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

      // NEW: permission.asked replaces deprecated permission.updated
      if (event.type === "permission.asked") {
        await handleEvent(pluginConfig, "permission")
      }

      // NEW: session.status replaces deprecated session.idle
      if (event.type === "session.status") {
        const typedEvent = event as EventWithProperties
        const status = typedEvent.properties?.status
        if (status?.type === "idle") {
          const now = timeProvider.now()
          
          // Skip idle if it's right after an error (error came first)
          if (lastErrorTime >= 0 && now - lastErrorTime < RACE_CONDITION_DEBOUNCE_MS) {
            return
          }
          
          // Determine event type: subagent or complete
          let eventType: EventType = "complete"
          
          // Check if this is a subagent session completion
          if (pluginInput) {
            try {
              const sessionID = typedEvent.properties?.sessionID as string | undefined
              if (sessionID) {
                const sessionResponse = await pluginInput.client.session.get({ path: { id: sessionID } })
                const session = sessionResponse.data
                
                // Use 'subagent' event type if it has a parent session
                if (session?.parentID) {
                  eventType = "subagent"
                }
              }
            } catch (error) {
              // Silently fallback to 'complete'
            }
          }
          
          // Record idle time FIRST for potential future error debouncing
          lastIdleTime = now
          
          await handleEvent(pluginConfig, eventType)
        }
      }

      // UNCHANGED: session.error still valid
      if (event.type === "session.error") {
        const now = timeProvider.now()
        
        // Skip error if idle just happened (idle came first but already sent notification)
        if (lastIdleTime >= 0 && now - lastIdleTime < RACE_CONDITION_DEBOUNCE_MS) {
          return
        }
        
        lastErrorTime = now
        await handleEvent(pluginConfig, "error")
      }
    },
  }
}

// Main plugin factory - exported for tests, used by index.ts for production
export async function createNotifierPluginInstance(pluginInput?: PluginInput) {
  return createNotifierPlugin(undefined, pluginInput)
}
