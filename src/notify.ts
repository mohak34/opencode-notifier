import os from "os"
import { execFile } from "child_process"
import { getLinuxNotificationID, rememberLinuxNotificationID, sendLinuxActionNotification } from "./notify-linux"
export { disposeLinuxNotifications } from "./notify-linux"
import notifier from "node-notifier"
import isWsl from "is-wsl"

const DEBOUNCE_MS = 1000

const platform = os.type()

let platformNotifier: { notify(notification: notifier.Notification, callback: notifier.NotificationCallback): unknown } = notifier

if (platform === "Windows_NT" || isWsl) {
  const { WindowsToaster } = notifier
  platformNotifier = new WindowsToaster({ withFallback: false })
} else if (platform === "Linux" || platform.match(/BSD$/)) {
  const { NotifySend } = notifier
  platformNotifier = new NotifySend({ withFallback: false })
} else if (platform !== "Darwin") {
  platformNotifier = notifier
}

export type NotificationAction = "focus" | "close"

const LINUX_FOCUS_ACTION_KEY = "focus-terminal"
const LINUX_FOCUS_ACTION_LABEL = "Jump to terminal"

const lastNotificationTime: Record<string, number> = {}

let linuxNotifySendSupportsReplace: boolean | null = null

function sanitizeGhosttyField(value: string): string {
  return value.replace(/[;\u0000-\u001f\u007f-\u009f]/g, "")
}

export function formatGhosttyNotificationSequence(
  title: string,
  message: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const escapedTitle = sanitizeGhosttyField(title)
  const escapedMessage = sanitizeGhosttyField(message)
  const payload = `\x1b]9;${escapedTitle}: ${escapedMessage}\x07`

  if (env.TMUX) {
    return `\x1bPtmux;\x1b${payload}\x1b\\`
  }

  return payload
}

function detectNotifySendCapabilities(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("notify-send", ["--version"], { timeout: 1000 }, (error, stdout) => {
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
  grouping: boolean = true
): Promise<void> {
  return new Promise((resolve) => {
    const args: string[] = []

    args.push("--app-name", "opencode")

    if (iconPath) {
      args.push("--icon", iconPath)
    }

    args.push("--expire-time", String(timeout * 1000))

    const lastID = getLinuxNotificationID()
    if (grouping && lastID !== null) {
      args.push("--replace-id", String(lastID))
    }

    if (grouping) {
      args.push("--print-id")
    }

    args.push("--", title, message)

    execFile("notify-send", args, { timeout: 2000 }, (error, stdout) => {
      if (!error && grouping && stdout) {
        const id = parseInt(stdout.trim(), 10)
        if (!isNaN(id)) {
          rememberLinuxNotificationID(id)
        }
      }
      resolve()
    })
  })
}

export function parseNotifySendOutputLine(
  line: string
): { type: "id"; id: number } | { type: "action"; action: NotificationAction } | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  if (/^\d+$/.test(trimmed)) {
    const id = parseInt(trimmed, 10)
    if (!isNaN(id)) {
      return { type: "id", id }
    }
  }

  if (trimmed === LINUX_FOCUS_ACTION_KEY) {
    return { type: "action", action: "focus" }
  }

  if (trimmed === "close") {
    return { type: "action", action: "close" }
  }

  return null
}

export interface WindowsNotificationOptions {
  title: string
  message: string
  timeout: number
  icon: string | undefined
  appName: string
}

export function buildWindowsNotificationOptions(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  windowsAppID?: string
): WindowsNotificationOptions {
  return {
    title: title,
    message: message,
    timeout: timeout,
    icon: iconPath,
    // node-notifier's WindowsToaster only maps `appName` (not the Linux
    // "app-name" key) to SnoreToast's -appID. Without it, toasts fall back
    // to the generic "SnoreToast" label (#114).
    appName: windowsAppID ?? "opencode",
  }
}

export function buildOsascriptNotificationArgs(title: string, message: string): string[] {
  return [
    "-e",
    "on run argv\n display notification (item 1 of argv) with title (item 2 of argv)\nend run",
    message,
    title,
  ]
}

export async function sendNotification(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  notificationSystem: "osascript" | "node-notifier" | "ghostty" = "osascript",
  linuxGrouping: boolean = true,
  onClick?: () => void,
  windowsAppID?: string,
  clickActionLabel: string = LINUX_FOCUS_ACTION_LABEL
): Promise<void> {
  const now = Date.now()
  if (lastNotificationTime[message] && now - lastNotificationTime[message] < DEBOUNCE_MS) {
    return
  }
  lastNotificationTime[message] = now

  if (notificationSystem === "ghostty") {
    return new Promise((resolve) => {
      const sequence = formatGhosttyNotificationSequence(title, message)
      process.stdout.write(sequence, () => {
        resolve()
      })
    })
  }

  if (platform === "Darwin") {
    if (notificationSystem === "node-notifier") {
      return new Promise((resolve) => {
        const notificationOptions = {
          title: title,
          message: message,
          timeout: timeout,
          icon: iconPath,
        }

        notifier.notify(
          notificationOptions,
          (_error, response) => {
            if (onClick && response === "activate") {
              try { onClick() } catch {}
            }
            resolve()
          }
        )
      })
    }

    return new Promise((resolve) => {
      execFile("osascript", buildOsascriptNotificationArgs(title, message), () => {
        resolve()
      })
    })
  }

  if ((platform === "Linux" || platform.match(/BSD$/)) && !isWsl) {
    if (!process.env.DBUS_SESSION_BUS_ADDRESS) return

    if (onClick) {
      const sent = await sendLinuxActionNotification(title, message, timeout, iconPath, linuxGrouping, onClick, clickActionLabel)
      if (sent) return
      // Fail open: a broken bus must still allow a plain popup without actions.
      return sendLinuxNotificationDirect(title, message, timeout, iconPath, linuxGrouping)
    }

    if (linuxGrouping) {
      if (linuxNotifySendSupportsReplace === null) {
        linuxNotifySendSupportsReplace = await detectNotifySendCapabilities()
      }
      if (linuxNotifySendSupportsReplace) {
        return sendLinuxNotificationDirect(title, message, timeout, iconPath, true)
      }
    }
  }

  return new Promise((resolve) => {
    const notificationOptions = buildWindowsNotificationOptions(title, message, timeout, iconPath, windowsAppID)

    platformNotifier.notify(
      notificationOptions,
      (_error, response, metadata) => {
        if (onClick && (response === "activate" || metadata?.activationType === "default" || metadata?.activationType === "activated")) {
          try { onClick() } catch {}
        }
        resolve()
      }
    )
  })
}
