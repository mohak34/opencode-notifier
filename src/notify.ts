import os from "node:os"

import notifier from "node-notifier"

import { DEBOUNCE_MS } from "./config"

const NOTIFICATION_TITLE = "OpenCode"

const platform = os.type()

let platformNotifier: typeof notifier

if (platform === "Linux" || platform.match(/BSD$/)) {
  platformNotifier = new notifier.NotifySend({ withFallback: false }) as unknown as typeof notifier
} else if (platform === "Darwin") {
  platformNotifier = new notifier.NotificationCenter({ withFallback: false }) as unknown as typeof notifier
} else if (platform === "Windows_NT") {
  platformNotifier = new notifier.WindowsToaster({ withFallback: false }) as unknown as typeof notifier
} else {
  platformNotifier = notifier
}

const lastNotificationTime: Record<string, number> = {}

export async function sendNotification(
  message: string,
  timeout: number,
  imagePath: string | null = null,
  title: string = "OpenCode"
): Promise<void> {
  const now = Date.now()
  if (lastNotificationTime[message] && now - lastNotificationTime[message] < DEBOUNCE_MS) {
    return
  }
  lastNotificationTime[message] = now

  return new Promise((resolve) => {
    const notificationOptions: Record<string, unknown> = {
      title: title,
      message: message,
      timeout: timeout,
    }

    if (platform === "Darwin") {
      notificationOptions.sound = false
      if (imagePath) {
        notificationOptions.contentImage = imagePath
      }
    } else if (platform === "Windows_NT" || platform === "Linux" || platform.match(/BSD$/)) {
      if (imagePath) {
        notificationOptions.icon = imagePath
      }
    }

    platformNotifier.notify(notificationOptions as notifier.Notification, () => {
      resolve()
    })
  })
}
