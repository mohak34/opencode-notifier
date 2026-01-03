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
  const sessionCache = new Map<string, { title: string; parentID?: string }>()

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

      // Update cache on session lifecycle events
      if (event.type === "session.created" || event.type === "session.updated") {
        const info = event.properties?.info as any
        if (info?.id && info?.title) {
          sessionCache.set(info.id, {
            title: info.title,
            parentID: info.parentID,
          })
        }
      }

      // Determine session title and ID
      let sessionID = event.properties?.sessionID as string | undefined
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
            // Silently fallback
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
            return
          }
          
          // Determine event type: subagent or complete
          let eventType: EventType = "complete"
          
          // Use 'subagent' event type if it has a parent session
          if (parentID) {
            eventType = "subagent"
          }
          
          // Record idle time FIRST for potential future error debouncing
          lastIdleTime = now
          
          await handleEvent(pluginConfig, eventType, sessionTitle)
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
        await handleEvent(pluginConfig, "error", sessionTitle)
      }
    },
  }
}

// Main plugin factory - exported for tests, used by index.ts for production
export async function createNotifierPluginInstance(pluginInput?: PluginInput) {
  return createNotifierPlugin(undefined, pluginInput)
}
