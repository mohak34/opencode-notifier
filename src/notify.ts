import os from "os"
import { exec, execFile, spawn } from "child_process"
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

const lastNotificationTime = new Map<string, number>()

const lastLinuxNotificationIds = new Map<string, number>()
let linuxNotifySendSupportsReplace: boolean | null = null
let linuxActionSupport: boolean | null = null
let linuxClipboardCommand: "wl-copy" | "xclip" | "xsel" | null | undefined

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

function getLinuxThreadKey(sessionID?: string | null, eventType?: NotificationEventType): string {
  if (sessionID && sessionID.length > 0) {
    const safeSessionID = sessionID.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64)
    return `opencode-session-${safeSessionID}`
  }
  return getLinuxStackTag(eventType)
}

function getLinuxIcon(eventType?: NotificationEventType): string {
  switch (eventType) {
    case "error":
      return "dialog-error"
    case "permission":
      return "dialog-warning"
    case "question":
      return "dialog-question"
    case "complete":
    case "subagent_complete":
      return "dialog-information"
    case "interrupted":
    case "user_cancelled":
      return "process-stop"
    default:
      return "dialog-information"
  }
}

function shouldEnableLinuxActions(eventType?: NotificationEventType): boolean {
  return eventType === "permission" || eventType === "question" || eventType === "error"
}

function getNotificationDebounceKey(message: string, eventType?: NotificationEventType, sessionID?: string | null): string {
  if (sessionID && eventType) {
    return `${sessionID}:${eventType}`
  }

  if (eventType) {
    return `${eventType}:${message}`
  }

  return message
}

function parseNotifySendOutput(stdout: string): { notificationId?: number; action?: "open" | "copy" } {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  let notificationId: number | undefined
  let action: "open" | "copy" | undefined

  for (const line of lines) {
    if (notificationId === undefined && /^\d+$/.test(line)) {
      notificationId = parseInt(line, 10)
      continue
    }

    if (line === "open" || line === "copy") {
      action = line
    }
  }

  return { notificationId, action }
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

function detectNotifySendActionSupport(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("notify-send", ["--help"], (error, stdout, stderr) => {
      if (error) {
        resolve(false)
        return
      }

      const helpText = `${stdout}\n${stderr}`
      resolve(helpText.includes("--action") && helpText.includes("--wait"))
    })
  })
}

function runDetached(command: string, args: string[] = []): void {
  execFile(command, args, () => undefined)
}

function detectLinuxClipboardCommand(): Promise<"wl-copy" | "xclip" | "xsel" | null> {
  if (linuxClipboardCommand !== undefined) {
    return Promise.resolve(linuxClipboardCommand)
  }

  return new Promise((resolve) => {
    const commands: Array<"wl-copy" | "xclip" | "xsel"> = ["wl-copy", "xclip", "xsel"]
    const tryNext = (index: number) => {
      if (index >= commands.length) {
        linuxClipboardCommand = null
        resolve(null)
        return
      }

      const cmd = commands[index]
      execFile("which", [cmd], (error) => {
        if (error) {
          tryNext(index + 1)
          return
        }

        linuxClipboardCommand = cmd
        resolve(cmd)
      })
    }

    tryNext(0)
  })
}

async function copyToLinuxClipboard(value: string): Promise<void> {
  const command = await detectLinuxClipboardCommand()
  if (!command) {
    return
  }

  if (command === "wl-copy") {
    const child = spawn("wl-copy", [])
    child.stdin.write(value)
    child.stdin.end()
    return
  }

  if (command === "xclip") {
    const child = spawn("xclip", ["-selection", "clipboard"])
    child.stdin.write(value)
    child.stdin.end()
    return
  }

  const child = spawn("xsel", ["--clipboard", "--input"])
  child.stdin.write(value)
  child.stdin.end()
}

async function handleLinuxAction(action: "open" | "copy", message: string, sessionID?: string | null): Promise<void> {
  if (action === "open") {
    if (sessionID && sessionID.length > 0) {
      runDetached("opencode", ["--session", sessionID])
      return
    }
    runDetached("opencode", [])
    return
  }

  if (action === "copy") {
    await copyToLinuxClipboard(message)
  }
}

function sendLinuxNotificationDirect(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  grouping: boolean = true,
  eventType?: NotificationEventType,
  sessionID?: string | null
): Promise<boolean> {
  return new Promise((resolve) => {
    const args: string[] = []
    const urgency = getLinuxUrgency(eventType)
    const threadKey = getLinuxThreadKey(sessionID, eventType)

    args.push("--icon", iconPath || getLinuxIcon(eventType))

    args.push("--expire-time", String(timeout * 1000))
    args.push("--urgency", urgency)
    args.push("--app-name", "OpenCode")
    args.push("--category", getLinuxCategory(eventType))

    args.push("--hint", "string:desktop-entry:opencode")
    args.push("--hint", `string:x-canonical-private-synchronous:${threadKey}`)
    args.push("--hint", `string:x-dunst-stack-tag:${threadKey}`)

    const lastNotificationId = lastLinuxNotificationIds.get(threadKey)
    if (grouping && typeof lastNotificationId === "number") {
      args.push("--replace-id", String(lastNotificationId))
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
        const parsed = parseNotifySendOutput(stdout)
        if (typeof parsed.notificationId === "number") {
          lastLinuxNotificationIds.set(threadKey, parsed.notificationId)
        }
      }
      resolve(true)
    })
  })
}

function sendLinuxNotificationWithActions(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  grouping: boolean = true,
  eventType?: NotificationEventType,
  sessionID?: string | null
): void {
  const args: string[] = []
  const urgency = getLinuxUrgency(eventType)
  const threadKey = getLinuxThreadKey(sessionID, eventType)

  args.push("--icon", iconPath || getLinuxIcon(eventType))
  args.push("--expire-time", String(timeout * 1000))
  args.push("--urgency", urgency)
  args.push("--app-name", "OpenCode")
  args.push("--category", getLinuxCategory(eventType))
  args.push("--hint", "string:desktop-entry:opencode")
  args.push("--hint", `string:x-canonical-private-synchronous:${threadKey}`)
  args.push("--hint", `string:x-dunst-stack-tag:${threadKey}`)
  args.push("--action", "open=Open OpenCode")
  args.push("--action", "copy=Copy message")
  args.push("--wait")

  const lastNotificationId = lastLinuxNotificationIds.get(threadKey)
  if (grouping && typeof lastNotificationId === "number") {
    args.push("--replace-id", String(lastNotificationId))
  }

  if (grouping) {
    args.push("--print-id")
  }

  args.push("--", title, message)

  const child = spawn("notify-send", args, {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  })

  let stdout = ""
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += String(chunk)
  })

  child.on("close", () => {
    const parsed = parseNotifySendOutput(stdout)
    if (typeof parsed.notificationId === "number") {
      lastLinuxNotificationIds.set(threadKey, parsed.notificationId)
    }

    if (parsed.action) {
      void handleLinuxAction(parsed.action, message, sessionID)
    }
  })

  child.unref()
}

export async function sendNotification(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  notificationSystem: "osascript" | "node-notifier" | "ghostty" = "osascript",
  linuxGrouping: boolean = true,
  eventType?: NotificationEventType,
  sessionID?: string | null
): Promise<void> {
  const now = Date.now()
  const debounceKey = getNotificationDebounceKey(message, eventType, sessionID)
  const last = lastNotificationTime.get(debounceKey)
  if (last && now - last < DEBOUNCE_MS) {
    return
  }
  lastNotificationTime.set(debounceKey, now)

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
    if (linuxActionSupport === null) {
      linuxActionSupport = await detectNotifySendActionSupport()
    }

    if (linuxActionSupport && shouldEnableLinuxActions(eventType)) {
      sendLinuxNotificationWithActions(title, message, timeout, iconPath, linuxGrouping, eventType, sessionID)
      return
    }

    if (linuxGrouping) {
      if (linuxNotifySendSupportsReplace === null) {
        linuxNotifySendSupportsReplace = await detectNotifySendCapabilities()
      }
      if (linuxNotifySendSupportsReplace) {
        const sent = await sendLinuxNotificationDirect(title, message, timeout, iconPath, true, eventType, sessionID)
        if (sent) {
          return
        }
      }
    }

    const sent = await sendLinuxNotificationDirect(title, message, timeout, iconPath, false, eventType, sessionID)
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
