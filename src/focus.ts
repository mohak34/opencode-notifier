import { execFileSync, execSync } from "child_process";

function execWithTimeout(command: string, timeoutMs: number = 500): string | null {
  try {
    return execSync(command, { timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function execFileWithTimeout(command: string, args: readonly string[], timeoutMs: number = 500): string | null {
  try {
    return execFileSync(command, args,{ timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
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

function getLinuxWaylandActiveWindowId(): string | null {
  const env = process.env
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return getHyprlandActiveWindowId()
  if (env.SWAYSOCK) return getSwayActiveWindowId()
  if (env.KDE_SESSION_VERSION) return execWithTimeout("kdotool getactivewindow")
  return null
}

function getWindowsActiveWindowId() {
  const script = `$type=Add-Type -Name FocusHelper -Namespace OpenCodeNotifier -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -PassThru; $type::GetForegroundWindow()`;
  let windowId = execFileWithTimeout("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], 1e3);
  if (!windowId)
    windowId = execFileWithTimeout("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], 1e3);
  return windowId;
}

function getMacOSActiveWindowId(): string | null {
  return execWithTimeout(
    `osascript -e 'tell application "System Events" to return id of window 1 of (first application process whose frontmost is true)'`
  )
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

const tmuxPane: string | null = process.env.TMUX_PANE ?? null

function isTmuxPaneActive(): boolean {
  if (!tmuxPane) return true
  const result = execWithTimeout(`tmux display-message -t ${tmuxPane} -p '#{session_attached} #{window_active} #{pane_active}'`)
  if (!result) return false
  const [sessionAttached, windowActive, paneActive] = result.split(" ")
  return sessionAttached === "1" && windowActive === "1" && paneActive === "1"
}

export function isTerminalFocused(): boolean {
  try {
    if (!cachedWindowId) return false
    const currentId = getActiveWindowId()
    if (currentId !== cachedWindowId) return false
    if (process.env.TMUX) return isTmuxPaneActive()
    return true
  } catch {
    return false
  }
}
