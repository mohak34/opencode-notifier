import os from "os"
import { execFile, spawn } from "child_process"
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

let lastLinuxNotificationId: number | null = null
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

// Local copy of the debug gate: importing it from ./focus would run that
// module's import-time window probing (D-Bus I/O) for every notify consumer.
function debugNotify(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) {
    console.error(`[opencode-notifier] ${message}`)
  }
}

// A nonzero notify-send exit within this window means it never entered
// --action/--wait mode (e.g. "Actions are not supported ... Displaying
// non-interactively"), as opposed to a daemon error after serving the popup.
const FAST_EXIT_THRESHOLD_MS = 500

export function isNotifySendActionBroken(stderr: string, exitCode: number | null, elapsedMs: number): boolean {
  // libnotify >= 0.8 refuses --action mode on Notification Spec 1.2 servers
  // (e.g. GNOME Shell 50): "Actions are not supported by this notifications
  // server. Displaying non-interactively.", exiting fast without waiting for
  // the click. The server itself still honors actions sent over D-Bus.
  if (/actions are not supported|non-interactively/i.test(stderr)) return true
  if (exitCode !== 0 && exitCode !== null && elapsedMs < FAST_EXIT_THRESHOLD_MS) return true
  return false
}

function notifyOverDbus(
  title: string,
  message: string,
  timeout: number,
  replacesId: number,
  iconPath?: string,
  grouping: boolean = true,
  actionLabel: string = LINUX_FOCUS_ACTION_LABEL
): Promise<number | null> {
  return new Promise((resolve) => {
    // notify-send --action is unavailable here; talk to
    // org.freedesktop.Notifications directly with the same action payload.
    // Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout)
    // gdbus parses each argument as GVariant text, so strings go in as quoted
    // literals. JSON string escapes are valid GVariant string escapes.
    execFile(
      "gdbus",
      [
        "call", "--session", "--dest", "org.freedesktop.Notifications",
        "--object-path", "/org/freedesktop/Notifications",
        "--method", "org.freedesktop.Notifications.Notify",
        "--",
        JSON.stringify("opencode"), String(replacesId), JSON.stringify(iconPath ?? ""),
        JSON.stringify(title), JSON.stringify(message),
        `[${JSON.stringify(LINUX_FOCUS_ACTION_KEY)}, ${JSON.stringify(actionLabel)}]`,
        "{}", String(Math.max(1, timeout) * 1000),
      ],
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null)
          return
        }
        const match = stdout.match(/uint32\s+(\d+)/)
        const id = match ? parseInt(match[1], 10) : NaN
        if (isNaN(id)) {
          resolve(null)
          return
        }
        if (grouping) {
          lastLinuxNotificationId = id
        }
        resolve(id)
      }
    )
  })
}

// One click listener per notification id. Replacing a notification keeps its
// id, so a new listener retires the old one instead of firing both callbacks.
const dbusActionListeners = new Map<number, () => void>()

function watchDbusAction(id: number, timeout: number, onAction: (action: NotificationAction) => void): void {
  dbusActionListeners.get(id)?.()

  const monitor = spawn("dbus-monitor", [
    "type='signal',path='/org/freedesktop/Notifications',interface='org.freedesktop.Notifications',member='ActionInvoked'",
  ], { stdio: ["ignore", "pipe", "pipe"] })
  const stop = () => {
    clearTimeout(expiry)
    if (dbusActionListeners.get(id) === stop) dbusActionListeners.delete(id)
    try { monitor.kill() } catch {}
  }
  const expiry = setTimeout(stop, Math.max(1, timeout) * 1000 + 1000)
  expiry.unref()
  dbusActionListeners.set(id, stop)

  // dbus-monitor prints a header line per message, then one indented line per
  // argument. ActionInvoked is (uint32 id, string action_key); both must
  // belong to the same signal.
  let partial = ""
  let signal: { id?: number } | null = null
  monitor.stdout?.on("data", (data) => {
    const lines = (partial + data.toString()).split("\n")
    partial = lines.pop() ?? ""
    for (const line of lines) {
      if (!/^\s/.test(line)) {
        signal = line.includes("member=ActionInvoked") ? {} : null
        continue
      }
      if (!signal) continue
      if (signal.id === undefined) {
        const idMatch = line.match(/^\s+uint32 (\d+)$/)
        signal = idMatch ? { id: parseInt(idMatch[1], 10) } : null
        continue
      }
      const actionMatch = line.match(/^\s+string "(.*)"$/)
      const matched = signal.id === id && actionMatch?.[1] === LINUX_FOCUS_ACTION_KEY
      signal = null
      if (matched && dbusActionListeners.get(id) === stop) {
        stop()
        try { onAction("focus") } catch {}
      }
    }
  })
  monitor.stderr?.resume()
  monitor.on("close", stop)
  monitor.on("error", stop)
}

function sendLinuxNotificationViaDbus(
  title: string,
  message: string,
  timeout: number,
  replacesId: number,
  iconPath?: string,
  grouping: boolean = true,
  onAction?: (action: NotificationAction) => void,
  actionLabel: string = LINUX_FOCUS_ACTION_LABEL
): Promise<void> {
  return notifyOverDbus(title, message, timeout, replacesId, iconPath, grouping, actionLabel).then((id) => {
    if (id !== null && onAction) {
      watchDbusAction(id, timeout, onAction)
    }
  })
}

function sendLinuxNotificationDirect(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  grouping: boolean = true,
  onAction?: (action: NotificationAction) => void,
  actionLabel: string = LINUX_FOCUS_ACTION_LABEL
): Promise<void> {
  return new Promise((resolve) => {
    if (onAction) {
      sendLinuxNotificationWithActions(title, message, timeout, iconPath, grouping, onAction, actionLabel)
        .then(() => resolve())
        .catch(() => resolve())
      return
    }

    const args: string[] = []

    args.push("--app-name", "opencode")

    if (iconPath) {
      args.push("--icon", iconPath)
    }

    args.push("--expire-time", String(timeout * 1000))

    if (grouping && lastLinuxNotificationId !== null) {
      args.push("--replace-id", String(lastLinuxNotificationId))
    }

    if (grouping) {
      args.push("--print-id")
    }

    args.push("--", title, message)

    execFile("notify-send", args, (error, stdout) => {
      if (!error && grouping && stdout) {
        const id = parseInt(stdout.trim(), 10)
        if (!isNaN(id)) {
          lastLinuxNotificationId = id
        }
      }
      resolve()
    })
  })
}

async function sendLinuxNotificationWithActions(
  title: string,
  message: string,
  timeout: number,
  iconPath?: string,
  grouping: boolean = true,
  onAction?: (action: NotificationAction) => void,
  actionLabel: string = LINUX_FOCUS_ACTION_LABEL
): Promise<void> {
  const args: string[] = ["--app-name", "opencode"]

  if (iconPath) {
    args.push("--icon", iconPath)
  }

  args.push("--expire-time", String(timeout * 1000))

  if (grouping && lastLinuxNotificationId !== null) {
    args.push("--replace-id", String(lastLinuxNotificationId))
  }

  // Always print ID so we can resolve early (before user clicks)
  // and still keep replace-id working.
  args.push("--print-id")

  args.push("--action", `${LINUX_FOCUS_ACTION_KEY}=${actionLabel}`)

  args.push("--", title, message)

  return new Promise((resolve) => {
    const child = spawn("notify-send", args, { stdio: ["ignore", "pipe", "pipe"] })
    const startedAt = Date.now()

    let stdout = ""
    let stderr = ""
    let clicked = false
    let fallbackStarted = false
    // notify-send still shows a non-interactive popup when it refuses
    // --action. The fallback replaces it rather than stacking a second one.
    let shownId: number | null = null
    // Some daemons ignore expiry. Bound each action listener so it cannot accumulate forever.
    const expiry = setTimeout(() => child.kill(), Math.max(1, timeout) * 1000 + 1000)
    expiry.unref()

    const fallbackToDbus = () => {
      if (fallbackStarted || clicked) return false
      fallbackStarted = true
      debugNotify("notify-send --action unsupported by this notification server, falling back to raw D-Bus Notify")
      const replacesId = shownId ?? (grouping ? lastLinuxNotificationId : null) ?? 0
      sendLinuxNotificationViaDbus(title, message, timeout, replacesId, iconPath, grouping, onAction, actionLabel)
        .then(() => resolve())
        .catch(() => resolve())
      return true
    }

    const consumeStdout = () => {
      const lines = stdout.split(/\r?\n/)
      // Keep the last partial line buffered.
      stdout = lines.pop() ?? ""

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
          continue
        }

        const parsed = parseNotifySendOutputLine(line)
        if (!parsed) {
          continue
        }

        if (parsed.type === "id") {
          shownId = parsed.id
          if (grouping) {
            lastLinuxNotificationId = parsed.id
          }
          resolve()
          continue
        }

        if (onAction && parsed.action === "focus" && !clicked) {
          clicked = true
          try { onAction("focus") } catch {}
        }
      }
    }

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
      consumeStdout()
    })
    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("close", (code: number | null) => {
      clearTimeout(expiry)
      // Flush any remaining buffered stdout when process exits.
      if (stdout.trim().length > 0) {
        stdout += "\n"
        consumeStdout()
      }
      if (
        onAction &&
        isNotifySendActionBroken(stderr, code, Date.now() - startedAt) &&
        fallbackToDbus()
      ) return
      resolve()
    })

    child.on("error", () => {
      clearTimeout(expiry)
      // notify-send missing or not executable: D-Bus is the only chance
      // left for a clickable popup.
      if (onAction && fallbackToDbus()) return
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
      if (linuxGrouping) {
        if (linuxNotifySendSupportsReplace === null) {
          linuxNotifySendSupportsReplace = await detectNotifySendCapabilities()
        }
        if (linuxNotifySendSupportsReplace) {
          return sendLinuxNotificationDirect(title, message, timeout, iconPath, true, () => onClick(), clickActionLabel)
        }
      }

      // Fallback without grouping so action click still works
      // even when --replace-id is unavailable or disabled.
      return sendLinuxNotificationDirect(title, message, timeout, iconPath, false, () => onClick(), clickActionLabel)
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
