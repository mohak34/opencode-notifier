import os from "os"
import { exec } from "child_process"
import notifier from "node-notifier"

const NOTIFICATION_TITLE = "OpenCode"
const DEBOUNCE_MS = 1000

const platform = os.type()

let platformNotifier: any

if (platform === "Linux" || platform.match(/BSD$/)) {
  const { NotifySend } = notifier
  platformNotifier = new NotifySend({ withFallback: false })
} else if (platform === "Windows_NT") {
  const { WindowsToaster } = notifier
  platformNotifier = new WindowsToaster({ withFallback: false })
} else if (platform !== "Darwin") {
  platformNotifier = notifier
}

const lastNotificationTime: Record<string, number> = {}

export async function sendNotification(
  message: string,
  timeout: number
): Promise<void> {
  const now = Date.now()
  if (lastNotificationTime[message] && now - lastNotificationTime[message] < DEBOUNCE_MS) {
    return
  }
  lastNotificationTime[message] = now

  if (platform === "Darwin") {
    return new Promise((resolve) => {
      const escapedMessage = message.replace(/"/g, '\\"')
      const escapedTitle = NOTIFICATION_TITLE.replace(/"/g, '\\"')
      exec(
        `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
        () => {
          resolve()
        }
      )
    })
  }

  return new Promise((resolve) => {
    const notificationOptions: any = {
      title: NOTIFICATION_TITLE,
      message: message,
      timeout: timeout,
      icon: undefined,
    }

    platformNotifier.notify(
      notificationOptions,
      (error: any, _response: any) => {
        if (error) console.error(error)
        resolve()
      }
    )
  })
}
