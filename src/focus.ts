import { execSync } from "child_process"
import { readFileSync } from "fs"

type TerminalInfo = {
  name: string
  macProcessNames: string[]
}

const TERMINAL_MAP: Record<string, TerminalInfo> = {
  ghostty: { name: "Ghostty", macProcessNames: ["Ghostty", "ghostty"] },
  kitty: { name: "kitty", macProcessNames: ["kitty"] },
  alacritty: { name: "Alacritty", macProcessNames: ["Alacritty", "alacritty"] },
  wezterm: { name: "WezTerm", macProcessNames: ["WezTerm", "wezterm-gui"] },
  apple_terminal: { name: "Terminal", macProcessNames: ["Terminal"] },
  iterm: { name: "iTerm2", macProcessNames: ["iTerm2", "iTerm"] },
  warp: { name: "Warp", macProcessNames: ["Warp"] },
  vscode: { name: "VS Code", macProcessNames: ["Code", "Code - Insiders", "Cursor", "cursor"] },
  windows_terminal: { name: "Windows Terminal", macProcessNames: [] },
  tmux: { name: "tmux", macProcessNames: [] },
}

let cachedTerminal: TerminalInfo | null | undefined = undefined

function detectTerminal(): TerminalInfo | null {
  if (cachedTerminal !== undefined) return cachedTerminal

  const env = process.env
  let result: TerminalInfo | null = null

  if (env.GHOSTTY_RESOURCES_DIR) {
    result = TERMINAL_MAP.ghostty
  } else if (env.KITTY_PID) {
    result = TERMINAL_MAP.kitty
  } else if (env.ALACRITTY_SOCKET || env.ALACRITTY_LOG) {
    result = TERMINAL_MAP.alacritty
  } else if (env.WEZTERM_EXECUTABLE) {
    result = TERMINAL_MAP.wezterm
  } else if (env.WT_SESSION) {
    result = TERMINAL_MAP.windows_terminal
  } else if (env.VSCODE_PID || env.TERM_PROGRAM === "vscode") {
    result = TERMINAL_MAP.vscode
  } else if (env.TERM_PROGRAM === "Apple_Terminal") {
    result = TERMINAL_MAP.apple_terminal
  } else if (env.TERM_PROGRAM === "iTerm.app") {
    result = TERMINAL_MAP.iterm
  } else if (env.TERM_PROGRAM === "WarpTerminal") {
    result = TERMINAL_MAP.warp
  } else if (env.TMUX || env.TERM_PROGRAM === "tmux") {
    result = TERMINAL_MAP.tmux
  }

  cachedTerminal = result
  return result
}

function execWithTimeout(command: string, timeoutMs: number = 500): string | null {
  try {
    return execSync(command, { timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function isMacOSFocused(terminal: TerminalInfo): boolean {
  const frontApp = execWithTimeout(
    `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
  )
  if (!frontApp) return false

  return terminal.macProcessNames.some(
    (name) => name.toLowerCase() === frontApp.toLowerCase()
  )
}

function getParentPid(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8")
    const closingParen = stat.lastIndexOf(")")
    if (closingParen === -1) return null
    const fields = stat.slice(closingParen + 2).split(" ")
    const ppid = parseInt(fields[1], 10)
    return Number.isFinite(ppid) ? ppid : null
  } catch {
    return null
  }
}

function getProcessTreeRoot(): number {
  if (process.env.TMUX) {
    const clientPidStr = execWithTimeout("tmux display-message -p '#{client_pid}'")
    if (clientPidStr) {
      const clientPid = parseInt(clientPidStr, 10)
      if (Number.isFinite(clientPid) && clientPid > 0) return clientPid
    }
  }
  return process.pid
}

function isPidAncestorOfProcess(targetPid: number, startPid: number): boolean {
  let currentPid = startPid

  for (let depth = 0; depth < 20; depth++) {
    if (currentPid === targetPid) return true
    if (currentPid <= 1) return false

    const ppid = getParentPid(currentPid)
    if (ppid === null) return false
    currentPid = ppid
  }

  return false
}

function isFocusedWindowOurs(windowPid: number): boolean {
  return isPidAncestorOfProcess(windowPid, getProcessTreeRoot())
}

function isLinuxX11Focused(): boolean {
  const pidStr = execWithTimeout("xdotool getactivewindow getwindowpid")
  if (!pidStr) return false

  const pid = parseInt(pidStr, 10)
  if (!Number.isFinite(pid) || pid <= 0) return false

  return isFocusedWindowOurs(pid)
}

function isHyprlandFocused(): boolean {
  const output = execWithTimeout("hyprctl activewindow -j")
  if (!output) return false

  try {
    const data = JSON.parse(output)
    const pid = data?.pid
    if (typeof pid !== "number" || pid <= 0) return false
    return isFocusedWindowOurs(pid)
  } catch {
    return false
  }
}

function isSwayFocused(): boolean {
  const output = execWithTimeout("swaymsg -t get_tree", 1000)
  if (!output) return false

  try {
    const tree = JSON.parse(output)
    const pid = findFocusedPid(tree)
    if (pid === null) return false
    return isFocusedWindowOurs(pid)
  } catch {
    return false
  }
}

function findFocusedPid(node: any): number | null {
  if (node.focused === true && typeof node.pid === "number") {
    return node.pid
  }

  if (Array.isArray(node.nodes)) {
    for (const child of node.nodes) {
      const pid = findFocusedPid(child)
      if (pid !== null) return pid
    }
  }

  if (Array.isArray(node.floating_nodes)) {
    for (const child of node.floating_nodes) {
      const pid = findFocusedPid(child)
      if (pid !== null) return pid
    }
  }

  return null
}

function isKDEWaylandFocused(): boolean {
  const windowId = execWithTimeout("kdotool getactivewindow")
  if (!windowId) return false

  const pidStr = execWithTimeout(`kdotool getwindowpid ${windowId}`)
  if (!pidStr) return false

  const pid = parseInt(pidStr, 10)
  if (!Number.isFinite(pid) || pid <= 0) return false

  return isFocusedWindowOurs(pid)
}

function isLinuxWaylandFocused(): boolean {
  const env = process.env

  if (env.HYPRLAND_INSTANCE_SIGNATURE) {
    return isHyprlandFocused()
  }

  if (env.SWAYSOCK) {
    return isSwayFocused()
  }

  if (env.KDE_SESSION_VERSION) {
    return isKDEWaylandFocused()
  }

  return false
}

function isWindowsFocused(): boolean {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusHelper {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$hwnd = [FocusHelper]::GetForegroundWindow()
$pid = 0
[void][FocusHelper]::GetWindowThreadProcessId($hwnd, [ref]$pid)
Write-Output $pid
`.trim().replace(/\n/g, "; ")

  const pidStr = execWithTimeout(`powershell -NoProfile -Command "${script}"`, 1000)
  if (!pidStr) return false

  const pid = parseInt(pidStr, 10)
  if (!Number.isFinite(pid) || pid <= 0) return false

  const startPid = getProcessTreeRoot()
  let currentPid = startPid
  for (let depth = 0; depth < 20; depth++) {
    if (currentPid === pid) return true
    if (currentPid <= 1) return false

    const parentPidStr = execWithTimeout(
      `powershell -NoProfile -Command "(Get-Process -Id ${currentPid}).Parent.Id"`,
      500
    )
    if (!parentPidStr) return false
    currentPid = parseInt(parentPidStr, 10)
    if (!Number.isFinite(currentPid)) return false
  }

  return false
}

export function isTerminalFocused(): boolean {
  try {
    const platform = process.platform

    if (platform === "darwin") {
      const terminal = detectTerminal()
      if (!terminal || terminal.macProcessNames.length === 0) return false
      return isMacOSFocused(terminal)
    }

    if (platform === "linux") {
      if (process.env.WAYLAND_DISPLAY) {
        return isLinuxWaylandFocused()
      }
      if (process.env.DISPLAY) {
        return isLinuxX11Focused()
      }
      return false
    }

    if (platform === "win32") {
      return isWindowsFocused()
    }

    return false
  } catch {
    return false
  }
}
