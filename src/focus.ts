import { execFileSync, execSync } from "child_process"

const MAC_TERMINAL_APP_NAMES = new Set<string>([
  "terminal",
  "iterm2",
  "ghostty",
  "wezterm",
  "alacritty",
  "kitty",
  "hyper",
  "warp",
  "tabby",
  "cursor",
  "visual studio code",
  "code",
  "code insiders",
  "zed",
  "rio",
])

function execWithTimeout(command: string, timeoutMs: number = 500): string | null {
  try {
    return execSync(command, { timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function execFileWithTimeout(command: string, args: readonly string[], timeoutMs: number = 500): string | null {
  try {
    return execFileSync(command, args, { timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function getHyprlandActiveWindowId(): string | null {
  const output = execWithTimeout("hyprctl activewindow -j")
  if (!output) return null
  try {
    const data = JSON.parse(output)
    return typeof data?.address === "string" ? data.address : null
  } catch {
    return null
  }
}

function findFocusedWindowId(node: any): string | null {
  if (node.focused === true && typeof node.id === "number") {
    return String(node.id)
  }

  if (Array.isArray(node.nodes)) {
    for (const child of node.nodes) {
      const id = findFocusedWindowId(child)
      if (id !== null) return id
    }
  }

  if (Array.isArray(node.floating_nodes)) {
    for (const child of node.floating_nodes) {
      const id = findFocusedWindowId(child)
      if (id !== null) return id
    }
  }

  return null
}

function getSwayActiveWindowId(): string | null {
  const output = execWithTimeout("swaymsg -t get_tree", 1000)
  if (!output) return null
  try {
    const tree = JSON.parse(output)
    return findFocusedWindowId(tree)
  } catch {
    return null
  }
}

function getNiriActiveWindowId(): string | null {
  const output = execWithTimeout("niri msg --json focused-window", 1000)
  if (!output) return null
  try {
    const data = JSON.parse(output)
    return typeof data?.id === "number" ? String(data.id) : null
  } catch {
    return null
  }
}

function getLinuxWaylandActiveWindowId(): string | null {
  const env = process.env
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return getHyprlandActiveWindowId()
  if (env.NIRI_SOCKET) return getNiriActiveWindowId()
  if (env.SWAYSOCK) return getSwayActiveWindowId()
  if (env.KDE_SESSION_VERSION) return execWithTimeout("kdotool getactivewindow")
  return null
}

function getWindowsActiveWindowId(): string | null {
  const script = `$type=Add-Type -Name FocusHelper -Namespace OpenCodeNotifier -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -PassThru; $type::GetForegroundWindow()`;
  let windowId = execFileWithTimeout("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 1000)
  if (!windowId)
    windowId = execFileWithTimeout("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], 1000)
  return windowId
}

function getMacOSActiveWindowId(): string | null {
  return execWithTimeout(
    `osascript -e 'tell application "System Events" to return id of window 1 of (first application process whose frontmost is true)'`
  )
}

function getMacOSFrontmostAppName(): string | null {
  return execWithTimeout(
    `osascript -e 'tell application "System Events" to return name of first application process whose frontmost is true'`
  )
}

function normalizeMacAppName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.app$/i, "")
    .replace(/\s+/g, " ")
}

function getExpectedMacTerminalAppNames(env: NodeJS.ProcessEnv): Set<string> {
  const expected = new Set<string>()
  const termProgram = typeof env.TERM_PROGRAM === "string" ? normalizeMacAppName(env.TERM_PROGRAM) : ""

  if (env.TMUX && (termProgram === "tmux" || termProgram === "screen" || termProgram.length === 0)) {
    return new Set(MAC_TERMINAL_APP_NAMES)
  }

  if (termProgram === "apple_terminal") {
    expected.add("terminal")
  } else if (termProgram === "iterm" || termProgram === "iterm2") {
    expected.add("iterm2")
  } else if (termProgram === "vscode") {
    expected.add("visual studio code")
    expected.add("code")
    expected.add("code insiders")
  } else if (termProgram === "warpterminal") {
    expected.add("warp")
  } else if (termProgram.length > 0) {
    expected.add(termProgram)
  }

  if (expected.size > 0) {
    return expected
  }

  return new Set(MAC_TERMINAL_APP_NAMES)
}

export function isMacTerminalAppFocused(frontmostAppName: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!frontmostAppName) {
    return false
  }

  const normalizedFrontmost = normalizeMacAppName(frontmostAppName)
  if (!normalizedFrontmost) {
    return false
  }

  const expectedApps = getExpectedMacTerminalAppNames(env)
  return expectedApps.has(normalizedFrontmost)
}

function getActiveWindowId(): string | null {
  const platform = process.platform
  if (platform === "darwin") return getMacOSActiveWindowId()
  if (platform === "linux") {
    if (process.env.WAYLAND_DISPLAY) return getLinuxWaylandActiveWindowId()
    if (process.env.DISPLAY) return execWithTimeout("xdotool getactivewindow")
    return null
  }
  if (platform === "win32") return getWindowsActiveWindowId()
  return null
}

const cachedWindowId: string | null = getActiveWindowId()

export function isTmuxPaneFocused(tmuxPane: string | null | undefined, probeResult: string | null): boolean {
  if (!tmuxPane) return false
  if (!probeResult) return false
  const [sessionAttached, windowActive, paneActive] = probeResult.split(" ")
  return sessionAttached === "1" && windowActive === "1" && paneActive === "1"
}

function isTmuxPaneActive(): boolean {
  const tmuxPane = process.env.TMUX_PANE ?? null
  const result = execFileWithTimeout("tmux", ["display-message", "-t", tmuxPane ?? "", "-p", "#{session_attached} #{window_active} #{pane_active}"])
  return isTmuxPaneFocused(tmuxPane, result)
}

export function isTerminalFocused(): boolean {
  try {
    if (process.platform === "darwin") {
      const frontmostAppName = getMacOSFrontmostAppName()
      if (!isMacTerminalAppFocused(frontmostAppName, process.env)) {
        return false
      }
      if (process.env.TMUX) {
        return isTmuxPaneActive()
      }
      return true
    }

    if (!cachedWindowId) return false
    const currentId = getActiveWindowId()
    if (currentId !== cachedWindowId) return false
    if (process.env.TMUX) return isTmuxPaneActive()
    return true
  } catch {
    return false
  }
}
