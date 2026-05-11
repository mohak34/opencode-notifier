import { execFile, execFileSync, execSync } from "child_process"
import { readFileSync, unlinkSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const LINUX_TERMINAL_APPS = new Set<string>([
  "ghostty",
  "konsole",
  "gnome-terminal",
  "xterm",
  "urxvt",
  "alacritty",
  "kitty",
  "wezterm",
  "wezterm-gui",
  "tilix",
  "terminator",
  "xfce4-terminal",
  "lxterminal",
  "mate-terminal",
  "deepin-terminal",
  "foot",
  "footclient",
])

const MAC_TERMINAL_APP_NAMES = new Set<string>([
  "terminal",
  "iterm2",
  "ghostty",
  "wezterm-gui",
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

export function parseWezTermFocusedPaneId(output: string): string | null {
  try {
    const data = JSON.parse(output)
    if (!Array.isArray(data)) return null
    for (const client of data) {
      if (typeof client?.focused_pane_id === "number") {
        return String(client.focused_pane_id)
      }
    }
    return null
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
  // Detect frontmost app regardless of activation policy
  // (apps excluded from Dock and App Switcher)
  const lsappinfo = execWithTimeout(
    `lsappinfo info -only name \`lsappinfo front\` | sed 's/.*="\\([^"]*\\)".*/\\1/'`
  )
  if (lsappinfo) return lsappinfo

  // Fallback to System Events if lsappinfo is unavailable
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
  } else if (termProgram === "wezterm") {
    expected.add("wezterm-gui")
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

let cachedWindowTitleValue: string | null | undefined

export function getCachedWindowTitle(): string | null {
  if (cachedWindowTitleValue !== undefined) {
    return cachedWindowTitleValue
  }
  cachedWindowTitleValue =
    process.platform === "linux" && !!process.env.KDE_SESSION_VERSION && cachedWindowId
      ? getWindowTitleFromKdotool(cachedWindowId)
      : null
  return cachedWindowTitleValue
}

export function isTmuxPaneFocused(tmuxPane: string | null | undefined, probeResult: string | null): boolean {
  if (!tmuxPane) return false
  if (!probeResult) return false
  const [sessionAttached, windowActive, paneActive] = probeResult.split(" ")
  return Number(sessionAttached) > 0 && windowActive === "1" && paneActive === "1"
}

export function isLinuxTerminalFocused(params: {
  cachedWindowId: string | null
  currentWindowId: string | null
  wezTermPaneActive: boolean
  tmuxPaneActive: boolean | null
}): boolean {
  const { cachedWindowId, currentWindowId, wezTermPaneActive, tmuxPaneActive } = params

  if (!cachedWindowId) {
    if (!wezTermPaneActive) return false
    if (tmuxPaneActive !== null) return tmuxPaneActive
    return false
  }

  if (currentWindowId !== cachedWindowId) return false
  if (!wezTermPaneActive) return false
  if (tmuxPaneActive !== null) return tmuxPaneActive
  return true
}

function isTmuxPaneActive(): boolean {
  const tmuxPane = process.env.TMUX_PANE ?? null
  const result = execFileWithTimeout("tmux", ["display-message", "-t", tmuxPane ?? "", "-p", "#{session_attached} #{window_active} #{pane_active}"])
  return isTmuxPaneFocused(tmuxPane, result)
}

function isWezTermPaneActive(): boolean {
  const weztermPane = process.env.WEZTERM_PANE ?? null
  if (!weztermPane) return true
  const output = execFileWithTimeout("wezterm", ["cli", "list-clients", "--format", "json"], 1000)
  if (!output) return false
  const focusedPaneId = parseWezTermFocusedPaneId(output)
  if (!focusedPaneId) return false
  return focusedPaneId === weztermPane
}

export function isTerminalFocused(): boolean {
  try {
    if (process.platform === "darwin") {
      const frontmostAppName = getMacOSFrontmostAppName()
      if (!isMacTerminalAppFocused(frontmostAppName, process.env)) {
        return false
      }
      if (!isWezTermPaneActive()) {
        return false
      }
      if (process.env.TMUX) {
        return isTmuxPaneActive()
      }
      return true
    }

    const tmuxPaneActive = process.env.TMUX ? isTmuxPaneActive() : null
    return isLinuxTerminalFocused({
      cachedWindowId,
      currentWindowId: getActiveWindowId(),
      wezTermPaneActive: isWezTermPaneActive(),
      tmuxPaneActive,
    })
  } catch {
    return false
  }
}

function getWindowIdFromXdotool(searchTerm: string): string | null {
  return execWithTimeout(`xdotool search --classname "${searchTerm}" | head -1`)
}

function getWindowIdFromKdotool(searchTerm: string): string | null {
  return execWithTimeout(`kdotool search --classname "${searchTerm}" | head -1`)
}

function getWindowTitleFromKdotool(windowId: string): string | null {
  return execWithTimeout(`kdotool getwindowname ${windowId}`)
}

let cachedKDEJumpBackSupport: boolean | null = null

export function isKDEJumpBackSupported(): boolean {
  if (process.platform !== "linux" || !process.env.KDE_SESSION_VERSION) {
    return false
  }

  if (cachedKDEJumpBackSupport !== null) {
    return cachedKDEJumpBackSupport
  }

  cachedKDEJumpBackSupport = execFileWithTimeout("kdotool", ["--help"], 1000) !== null
  return cachedKDEJumpBackSupport
}

function getWindowClassX11(windowId: string): string | null {
  return execWithTimeout(`xprop -id ${windowId} WM_CLASS 2>/dev/null | awk -F '"' '{print $4}'`)
}

function getWaylandAppId(windowId: string): string | null {
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    const output = execWithTimeout(`hyprctl clients -j`)
    if (!output) return null
    try {
      const clients = JSON.parse(output)
      for (const client of clients) {
        if (String(client.address) === windowId) {
          return client.class?.toLowerCase() || client.initialClass?.toLowerCase() || null
        }
      }
    } catch {
      return null
    }
  }

  if (process.env.SWAYSOCK) {
    const output = execWithTimeout(`swaymsg -t get_tree`, 1000)
    if (!output) return null
    try {
      const tree = JSON.parse(output)
      const findWindow = (node: any): string | null => {
        if (String(node.id) === windowId) {
          return node.app_id?.toLowerCase() || node.window_properties?.class?.toLowerCase() || null
        }
        if (Array.isArray(node.nodes)) {
          for (const child of node.nodes) {
            const result = findWindow(child)
            if (result) return result
          }
        }
        if (Array.isArray(node.floating_nodes)) {
          for (const child of node.floating_nodes) {
            const result = findWindow(child)
            if (result) return result
          }
        }
        return null
      }
      return findWindow(tree)
    } catch {
      return null
    }
  }

  if (process.env.NIRI_SOCKET) {
    const output = execWithTimeout(`niri msg --json windows`)
    if (!output) return null
    try {
      const windows = JSON.parse(output)
      for (const window of windows) {
        if (String(window.id) === windowId) {
          return window.app_id?.toLowerCase() || null
        }
      }
    } catch {
      return null
    }
  }

  return null
}

function getTerminalWindowId(): string | null {
  if (process.platform !== "linux") return null

  const term = process.env.TERM_PROGRAM?.toLowerCase() || ""
  const desktopSession = process.env.DESKTOP_SESSION?.toLowerCase() || ""
  const isKDE = process.env.KDE_SESSION_VERSION || desktopSession.includes("plasma")

  if (process.env.WAYLAND_DISPLAY) {
    const cachedId = cachedWindowId
    if (cachedId) {
      const appId = getWaylandAppId(cachedId)
      if (appId && LINUX_TERMINAL_APPS.has(appId)) {
        return cachedId
      }
    }
    // On KDE Wayland, kdotool may not be available, so we rely on KWin scripts
    if (isKDE) {
      return cachedId || "kde-wayland"
    }
    return cachedId
  }

  if (process.env.DISPLAY) {
    const cachedId = cachedWindowId
    if (cachedId) {
      const windowClass = getWindowClassX11(cachedId)
      if (windowClass && LINUX_TERMINAL_APPS.has(windowClass.toLowerCase())) {
        return cachedId
      }
    }
    for (const app of LINUX_TERMINAL_APPS) {
      const id = isKDE ? getWindowIdFromKdotool(app) : getWindowIdFromXdotool(app)
      if (id) return id
    }
  }

  return null
}

function focusLinuxWindowX11(windowId: string): void {
  try {
    execSync(`xdotool windowactivate ${windowId} 2>/dev/null`, { timeout: 1000 })
  } catch {
  }
}

function focusLinuxWindowKDE(windowId: string): void {
  try {
    const result = execWithTimeout(`kdotool getactivewindow`)
    if (result === windowId) return
    execSync(`kdotool windowactivate ${windowId} 2>/dev/null`, { timeout: 1000 })
  } catch {
    // kdotool not available, try KWin script approach
    focusKDEWithKWinScript()
  }
}

// Walk up the process tree to find the terminal PID dynamically
function findTerminalPid(): number {
  try {
    let currentPid = process.pid

    // Walk up the process tree
    while (currentPid > 1) {
      try {
        // Read the parent PID from /proc
        const statContent = readFileSync(`/proc/${currentPid}/stat`, "utf-8")
        // Extract parent PID from stat file (field 4)
        const match = statContent.match(/^\d+\s+\([^)]+\)\s+\S\s+(\d+)/)
        if (!match) break

        const ppid = parseInt(match[1], 10)

        // Read the command name
        const cmdline = readFileSync(`/proc/${ppid}/comm`, "utf-8").trim()

        // Check if this looks like a terminal
        if (cmdline.match(/ghostty|konsole|gnome-terminal|xterm|alacritty|kitty|wezterm|terminator|tilix|foot/i)) {
          return ppid
        }

        currentPid = ppid
      } catch {
        break
      }
    }

    // Fallback to PPID if no terminal found
    return process.ppid
  } catch {
    return process.ppid
  }
}

function focusKDEWithKWinScript(): void {
  try {
    const pinnedWindowId = process.env.OPENCODE_NOTIFIER_WINDOW_ID?.trim() || null
    if (pinnedWindowId) {
      try {
        execSync(`kdotool windowactivate ${pinnedWindowId} 2>/dev/null`, { timeout: 1500 })
        return
      } catch {
      }
    }

    if (cachedWindowId) {
      try {
        execSync(`kdotool windowactivate ${cachedWindowId} 2>/dev/null`, { timeout: 1500 })
        return
      } catch {
      }
    }

    // Find terminal PID dynamically (OpenCode might be a daemon)
    const terminalPid = findTerminalPid()
    const currentPid = process.pid
    const termProgram = (process.env.TERM_PROGRAM || "terminal").toLowerCase()
    const cwd = process.cwd().toLowerCase()
    const cwdBase = cwd.split("/").filter(Boolean).pop() || ""
    const cachedTitle = (getCachedWindowTitle() || "").toLowerCase()

    // Create a temporary KWin script
    const scriptContent = `
function activateTargetWindow(window) {
    // Jump to the window's desktop/activity first, then activate.
    // This works more reliably on Plasma than moving windows between desktops.
    try {
        if (window.desktops && window.desktops.length > 0) {
            workspace.currentDesktop = window.desktops[0];
        } else if (typeof window.desktop === "number" && window.desktop > 0) {
            workspace.currentDesktop = window.desktop;
        }
    } catch (e) {}

    try {
        if (window.activities && window.activities.length > 0 && typeof workspace.currentActivity !== "undefined") {
            workspace.currentActivity = window.activities[0];
        }
    } catch (e) {}

    try { window.minimized = false; } catch (e) {}

    try { workspace.activeWindow = window; } catch (e) {}
    try {
        if (typeof workspace.activateWindow === "function") {
            workspace.activateWindow(window);
        }
    } catch (e) {}
    try { window.active = true; } catch (e) {}

    // Nudge stacking so KWin treats this like an explicit user jump.
    try {
        window.keepAbove = true;
        window.keepAbove = false;
    } catch (e) {}
}

function isLikelyTerminal(window) {
    var resourceClass = (window.resourceClass || "").toLowerCase();
    var resourceName = (window.resourceName || "").toLowerCase();
    var caption = (window.caption || "").toLowerCase();

    return resourceClass.indexOf("ghostty") !== -1 ||
           resourceName.indexOf("ghostty") !== -1 ||
           caption.indexOf("ghostty") !== -1 ||
           resourceClass.indexOf("konsole") !== -1 ||
           resourceName.indexOf("konsole") !== -1 ||
           caption.indexOf("konsole") !== -1 ||
           resourceClass.indexOf("terminal") !== -1 ||
           resourceName.indexOf("terminal") !== -1;
}

function findAndActivateTerminal() {
    var allWindows = workspace.windowList();
    var terminalPid = ${terminalPid};
    var termProgramHint = ${JSON.stringify(termProgram)};
    var cwdHint = ${JSON.stringify(cwd)};
    var cwdBaseHint = ${JSON.stringify(cwdBase)};
    var cachedTitleHint = ${JSON.stringify(cachedTitle)};

    function contains(haystack, needle) {
        return !!needle && needle.length > 0 && haystack.indexOf(needle) !== -1;
    }

    function windowScore(window) {
        var resourceClass = (window.resourceClass || "").toLowerCase();
        var resourceName = (window.resourceName || "").toLowerCase();
        var caption = (window.caption || "").toLowerCase();
        var score = 0;

        if (window.pid === terminalPid) score += 30;
        if (contains(caption, "opencode")) score += 60;
        if (contains(caption, cachedTitleHint)) score += 50;
        if (contains(caption, cwdBaseHint)) score += 35;
        if (contains(caption, cwdHint)) score += 20;
        if (contains(resourceClass, termProgramHint) || contains(resourceName, termProgramHint) || contains(caption, termProgramHint)) score += 20;
        if (isLikelyTerminal(window)) score += 10;
        if (window.minimized === true) score -= 5;

        return score;
    }

    var bestWindow = null;
    var bestScore = -1;

    for (var i = 0; i < allWindows.length; i++) {
        var candidate = allWindows[i];
        var score = windowScore(candidate);
        if (score > bestScore) {
            bestWindow = candidate;
            bestScore = score;
        }
    }

    // Require enough confidence to avoid jumping to unrelated terminals.
    if (bestWindow && bestScore >= 30) {
        activateTargetWindow(bestWindow);
        return true;
    }

    return false;
}

findAndActivateTerminal();
`;
    
    const scriptPath = join(tmpdir(), `opencode-focus-${currentPid}.kwinscript`)
    const pluginName = `opencode-focus-${currentPid}`
    writeFileSync(scriptPath, scriptContent)

    // Load the script
    execSync(
      `qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${scriptPath}" "${pluginName}"`,
      { encoding: "utf-8", timeout: 2000 }
    )

    // Start the script
    execSync(
      `qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start`,
      { timeout: 2000 }
    )

    // Clean up
    try {
      unlinkSync(scriptPath)
    } catch {}

    // Unload the script after a short delay
    setTimeout(() => {
      try {
        execSync(
          `qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${pluginName}"`,
          { timeout: 500 }
        )
      } catch {}
    }, 1000)
    
  } catch {
    // Fall back to xdotool
    try {
      const cachedId = cachedWindowId;
      if (cachedId) {
        execSync(`xdotool windowactivate ${cachedId} 2>/dev/null`, { timeout: 1000 });
      }
    } catch {}
  }
}

function focusLinuxWindowHyprland(windowId: string): void {
  try {
    execSync(`hyprctl dispatch focuswindow address:${windowId} 2>/dev/null`, { timeout: 1000 })
  } catch {
  }
}

function focusLinuxWindowSway(windowId: string): void {
  try {
    execSync(`swaymsg "[con_id=${windowId}] focus" 2>/dev/null`, { timeout: 1000 })
  } catch {
  }
}

function focusLinuxWindowNiri(windowId: string): void {
  try {
    execSync(`niri msg action focus-window --id ${windowId} 2>/dev/null`, { timeout: 1000 })
  } catch {
  }
}

export function captureStartupWindowId(): void {
  if (!isKDEJumpBackSupported()) {
    return
  }

  const existing = process.env.OPENCODE_NOTIFIER_WINDOW_ID?.trim()
  if (existing) {
    return
  }

  const detected = execWithTimeout("kdotool getactivewindow", 1000)
  if (detected && /^\d+$/.test(detected)) {
    process.env.OPENCODE_NOTIFIER_WINDOW_ID = detected
  }
}

export async function focusTerminal(): Promise<void> {
  if (process.platform === "darwin") {
    try {
      const frontmostAppName = getMacOSFrontmostAppName()
      if (frontmostAppName && isMacTerminalAppFocused(frontmostAppName, process.env)) {
        return
      }
      const expectedApps = getExpectedMacTerminalAppNames(process.env)
      for (const app of expectedApps) {
        try {
          execSync(`osascript -e 'tell application "${app}" to activate' 2>/dev/null`, { timeout: 1000 })
          return
        } catch {
        }
      }
      execSync(`osascript -e 'tell application "Terminal" to activate' 2>/dev/null`, { timeout: 1000 })
    } catch {
    }
    return
  }

  if (process.platform === "linux") {
    const env = process.env
    
    // For KDE Plasma, use KWin script approach which works on both X11 and Wayland
    if (env.KDE_SESSION_VERSION) {
      focusKDEWithKWinScript()
      return
    }
    
    const windowId = getTerminalWindowId()
    if (!windowId) return

    if (env.HYPRLAND_INSTANCE_SIGNATURE) {
      focusLinuxWindowHyprland(windowId)
    } else if (env.SWAYSOCK) {
      focusLinuxWindowSway(windowId)
    } else if (env.NIRI_SOCKET) {
      focusLinuxWindowNiri(windowId)
    } else if (env.DISPLAY) {
      focusLinuxWindowX11(windowId)
    }
  }
}
