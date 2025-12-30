import os from "os"
import notifier from "node-notifier"

const NOTIFICATION_TITLE = "OpenCode"

const platform = os.type()

let platformNotifier: any

if (platform === "Linux" || platform.match(/BSD$/)) {
  const { NotifySend } = notifier
  platformNotifier = new NotifySend({ withFallback: false })
} else if (platform === "Darwin") {
  const { NotificationCenter } = notifier
  platformNotifier = new NotificationCenter({ withFallback: false })
} else if (platform === "Windows_NT") {
  const { WindowsToaster } = notifier
  platformNotifier = new WindowsToaster({ withFallback: false })
} else {
  console.warn(`[opencode-notifier] Unsupported platform: ${platform}. Using generic notifier with fallback enabled.`)
  platformNotifier = notifier
}

export async function sendNotification(
  message: string,
  timeout: number
): Promise<void> {
  return new Promise((resolve) => {
    const notificationOptions: any = {
      title: NOTIFICATION_TITLE,
      message: message,
      timeout: timeout,
      icon: undefined,
    }

    if (platform === "Darwin") {
      notificationOptions.sound = false
    }

    platformNotifier.notify(
      notificationOptions,
      () => {
        resolve()
      }
    )
  })
}
