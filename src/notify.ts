import os from "os"
import { exec, execFile } from "child_process"
import notifier from "node-notifier"

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

let lastLinuxNotificationId: number | null = null
let linuxNotifySendSupportsReplace: boolean | null = null

type NotificationEventType =
  | "permission"
  | "complete"
  | "subagent_complete"
  | "error"
  | "question"
  | "interrupted"
  | "user_cancelled"

function getLinuxUrgency(eventType?: NotificationEventType): "low" | "normal" | "critical" {
  switch (eventType) {
    case "error":
      return "critical"
    case "user_cancelled":
      return "low"
    default:
      return "normal"
  }
}

function getLinuxCategory(eventType?: NotificationEventType): string {
  switch (eventType) {
    case "error":
      return "im.error"
    case "permission":
    case "question":
      return "im.received"
    case "complete":
    case "subagent_complete":
      return "transfer.complete"
    case "interrupted":
    case "user_cancelled":
      return "transfer.warning"
    default:
      return "im"
  }
}

function getLinuxStackTag(eventType?: NotificationEventType): string {
  return eventType ? `opencode-${eventType}` : "opencode"
}

function detectNotifySendCapabilities(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("notify-send", ["--version"], (error, stdout) => {
      if (error) {
        resolve(false)
        return
      }
      const match = stdout.match(/(\d+)\.(\d+)/)
      if (match) {
        const major = parseInt(match[1], 10)
        const minor = parseInt(match[2], 10)
        resolve(major > 0 || (major === 0 && minor >= 8))
        return
      }
      resolve(false)
    })
  })
}

function sendLinuxNotificationDirect(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  grouping: boolean = true,
  eventType?: NotificationEventType
): Promise<boolean> {
  return new Promise((resolve) => {
    const args: string[] = []
    const urgency = getLinuxUrgency(eventType)

    if (iconPath) {
      args.push("--icon", iconPath)
    }

    args.push("--expire-time", String(timeout * 1000))
    args.push("--urgency", urgency)
    args.push("--app-name", "OpenCode")
    args.push("--category", getLinuxCategory(eventType))

    const stackTag = getLinuxStackTag(eventType)
    args.push("--hint", "string:desktop-entry:opencode")
    args.push("--hint", `string:x-canonical-private-synchronous:${stackTag}`)
    args.push("--hint", `string:x-dunst-stack-tag:${stackTag}`)

    if (grouping && lastLinuxNotificationId !== null) {
      args.push("--replace-id", String(lastLinuxNotificationId))
    }

    if (grouping) {
      args.push("--print-id")
    }

    args.push("--", title, message)

    execFile("notify-send", args, (error, stdout) => {
      if (error) {
        resolve(false)
        return
      }

      if (grouping && stdout) {
        const id = parseInt(stdout.trim(), 10)
        if (!isNaN(id)) {
          lastLinuxNotificationId = id
        }
      }
      resolve(true)
    })
  })
}

export async function sendNotification(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  notificationSystem: "osascript" | "node-notifier" | "ghostty" = "osascript",
  linuxGrouping: boolean = true,
  eventType?: NotificationEventType
): Promise<void> {
  const now = Date.now()
  if (lastNotificationTime[message] && now - lastNotificationTime[message] < DEBOUNCE_MS) {
    return
  }
  lastNotificationTime[message] = now

  if (notificationSystem === "ghostty") {
    return new Promise((resolve) => {
      const escapedTitle = title.replace(/[;\x07\x1b\n\r]/g, "")
      const escapedMessage = message.replace(/[;\x07\x1b\n\r]/g, "")
      process.stdout.write(`\x1b]9;${escapedTitle}: ${escapedMessage}\x07`, () => {
        resolve()
      })
    })
  }

  if (platform === "Darwin") {
    if (notificationSystem === "node-notifier") {
      return new Promise((resolve) => {
        const notificationOptions: any = {
          title: title,
          message: message,
          timeout: timeout,
          icon: iconPath,
        }

        notifier.notify(
          notificationOptions,
          () => {
            resolve()
          }
        )
      })
    }

    return new Promise((resolve) => {
      const escapedMessage = message.replace(/"/g, '\\"')
      const escapedTitle = title.replace(/"/g, '\\"')
      exec(
        `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
        () => {
          resolve()
        }
      )
    })
  }

  if (platform === "Linux" || platform.match(/BSD$/)) {
    if (linuxGrouping) {
      if (linuxNotifySendSupportsReplace === null) {
        linuxNotifySendSupportsReplace = await detectNotifySendCapabilities()
      }
      if (linuxNotifySendSupportsReplace) {
        const sent = await sendLinuxNotificationDirect(title, message, timeout, iconPath, true, eventType)
        if (sent) {
          return
        }
      }
    }

    const sent = await sendLinuxNotificationDirect(title, message, timeout, iconPath, false, eventType)
    if (sent) {
      return
    }
  }

  return new Promise((resolve) => {
    const notificationOptions: any = {
      title: title,
      message: message,
      timeout: timeout,
      icon: iconPath,
    }

    platformNotifier.notify(
      notificationOptions,
      () => {
        resolve()
      }
    )
  })
}
