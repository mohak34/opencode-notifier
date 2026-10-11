import { execFile, execFileSync, execSync } from "child_process"
import { accessSync, constants, readFileSync, statSync } from "fs"
import { delimiter, join } from "path"
import { getWindowsFocus } from "./focus-windows"

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
    return execFileSync(command, args, { timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim()
  } catch {
    return null
  }
}

function execFileAsync(command: string, args: readonly string[], timeout = 500): Promise<string | null> {
  return new Promise(resolve => {
    execFile(command, args, { timeout, encoding: "utf-8", windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout.trim())
    })
  })
}

function isNumericWindowId(value: string): boolean {
  return /^\d+$/.test(value)
}

// KWin 6 / kdotool identify native Wayland windows with braced UUIDs.
// Keep this validator separate from numeric X11/Sway/Niri IDs.
export function isKDEWindowId(value: string): boolean {
  return isNumericWindowId(value) || /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i.test(value)
}

function firstKDEWindowId(output: string | null): string | null {
  return output?.split(/\s+/).find(isKDEWindowId) ?? null
}

function getPinnedKDEWindowId(): string | null {
  const id = process.env.OPENCODE_NOTIFIER_WINDOW_ID?.trim()
  return id && isKDEWindowId(id) ? id : null
}

function isSafeCompositorWindowId(value: string): boolean {
  return /^[A-Za-z0-9._:-]+$/.test(value)
}

function firstNumericWindowId(output: string | null): string | null {
  if (!output) return null

  const value = output.split(/\s+/).find((part) => isNumericWindowId(part))
  return value ?? null
}

function getHyprlandActiveWindowId(): string | null {
  const output = execWithTimeout("hyprctl activewindow -j")
  if (!output) return null
  try {
    const data = JSON.parse(output)
    return typeof data?.address === "string" && isSafeCompositorWindowId(data.address) ? data.address : null
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
  if (env.KDE_SESSION_VERSION) return firstKDEWindowId(execWithTimeout("kdotool getactivewindow"))
  if (isGnomeLikeSession(env)) return getGnomeShellWindowKey() ?? getGnomeAtspiActiveWindowKey()
  return null
}

// --- GNOME Wayland focus detection via AT-SPI --------------------------------
// GNOME intentionally exposes no compositor API for the focused window
// (Introspect GetWindows/Eval are AccessDenied), and XWayland tools like
// xdotool cannot see native Wayland windows. The accessibility bus is the
// remaining out-of-band channel: every toolkit window (including Ghostty's
// /com/mitchellh/ghostty nodes) reports AT-SPI states, where bit 1 (ACTIVE)
// means "window is currently the active window". Verified on Ubuntu 26.04.1 LTS /
// GNOME Shell 50.1 + Ghostty 1.3.0 by sampling states across real focus switches
// (issues #83, #104).

const ATSPI_ACTIVE_BIT_INDEX = 1

const ATSPI_TERMINAL_PATH_MARKERS = ["mitchellh/ghostty"]

// AT-SPI application `Name` values can differ from the Wayland/X app ids in
// LINUX_TERMINAL_APPS (e.g. GNOME Terminal exposes `gnome-terminal-server`
// on the accessibility bus). Keep bus-specific aliases here so the a11y
// matcher sees the real names without polluting X11/Wayland id matching.
const ATSPI_TERMINAL_APP_ALIASES = new Set<string>([
  "gnome-terminal-server",
])

const GNOME_LIKE_DESKTOPS = new Set(["gnome", "ubuntu", "pop"])

export function isGnomeLikeSession(env: NodeJS.ProcessEnv = process.env): boolean {
  const desktop = `${env.XDG_CURRENT_DESKTOP ?? ""} ${env.DESKTOP_SESSION ?? ""}`.toLowerCase()
  return desktop.split(/[:;\s]+/).some((token) => GNOME_LIKE_DESKTOPS.has(token))
}

export function getLinuxFocusBackendName(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return "hyprland"
  if (env.NIRI_SOCKET) return "niri"
  if (env.SWAYSOCK) return "sway"
  if (env.KDE_SESSION_VERSION) return "kde"
  if (isGnomeLikeSession(env)) return "gnome-atspi"
  if (env.DISPLAY) return "x11"
  if (env.WAYLAND_DISPLAY) return "wayland-unsupported"
  return "none"
}

export function parseAtspiString(output: string | null): string | null {
  if (!output) return null
  const match = output.match(/'((?:[^'\\]|\\.)*)'/)
  if (!match) return null
  try {
    return JSON.parse(`"${match[1].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
  } catch {
    return match[1]
  }
}

export interface AtspiObjectRef {
  bus: string
  path: string
}

export function parseAtspiObjectRefs(output: string | null): AtspiObjectRef[] {
  if (!output) return []
  const refs: AtspiObjectRef[] = []
  const re = /\('([^']+)',\s*(?:objectpath\s+)?'([^']+)'\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(output)) !== null) {
    refs.push({ bus: match[1], path: match[2] })
  }
  return refs
}

export function parseAtspiStateActive(output: string | null): boolean | null {
  if (!output) return null
  const match = output.match(/uint32\s+(\d+)/)
  if (!match) return null
  const firstWord = Number(match[1]) >>> 0
  return ((firstWord >>> ATSPI_ACTIVE_BIT_INDEX) & 1) === 1
}

export function isAtspiTerminalWindow(appName: string | null, windowPath: string): boolean {
  if (ATSPI_TERMINAL_PATH_MARKERS.some((marker) => windowPath.toLowerCase().includes(marker))) {
    return true
  }
  if (!appName) return false
  const normalized = appName.trim().toLowerCase()
  return LINUX_TERMINAL_APPS.has(normalized) || ATSPI_TERMINAL_APP_ALIASES.has(normalized)
}

const ATSPI_ROLES = new Set(["window", "frame", "dialog"])

// Fail-open policy: only windows whose role we positively recognize as a
// top-level window are terminal candidates. An unknown role (null) means the
// lookup failed, so the window is excluded rather than risk suppressing a
// notification for a window we cannot identify.
export function isAtspiWindowRoleAccepted(role: string | null): boolean {
  return role !== null && ATSPI_ROLES.has(role)
}

function callAtspi(
  address: string,
  dest: string,
  path: string,
  method: string,
  args: readonly string[] = [],
  timeoutMs: number = 500
): string | null {
  return execFileWithTimeout("gdbus", [
    "call", "--address", address,
    "--dest", dest,
    "--object-path", path,
    "--method", method,
    ...args,
  ], timeoutMs)
}

let cachedAtspiAddress: { address: string; at: number } | null = null
const ATSPI_ADDRESS_CACHE_TTL_MS = 10_000

function getAtspiBusAddress(): string | null {
  const now = Date.now()
  if (cachedAtspiAddress && now - cachedAtspiAddress.at < ATSPI_ADDRESS_CACHE_TTL_MS) {
    return cachedAtspiAddress.address
  }
  // The session bus address is stable, but a stale cache must never hard-fail
  // detection: every caller treats null as "unknown" and fails open.
  cachedAtspiAddress = null
  const output = execFileWithTimeout("gdbus", [
    "call", "--session",
    "--dest", "org.a11y.Bus",
    "--object-path", "/org/a11y/bus",
    "--method", "org.a11y.Bus.GetAddress",
  ], 1000)
  const address = parseAtspiString(output)
  if (address) {
    cachedAtspiAddress = { address, at: now }
  }
  return address
}

function getAtspiWindowRole(address: string, ref: AtspiObjectRef): string | null {
  const output = callAtspi(address, ref.bus, ref.path, "org.a11y.atspi.Accessible.GetRoleName")
  return parseAtspiString(output)
}

function isAtspiWindowActive(address: string, ref: AtspiObjectRef): boolean | null {
  const output = callAtspi(address, ref.bus, ref.path, "org.a11y.atspi.Accessible.GetState")
  return parseAtspiStateActive(output)
}

function getAtspiTerminalWindowRefs(address: string): AtspiObjectRef[] {
  const refs: AtspiObjectRef[] = []
  const rootOutput = callAtspi(
    address,
    "org.a11y.atspi.Registry",
    "/org/a11y/atspi/accessible/root",
    "org.a11y.atspi.Accessible.GetChildren",
    [],
    1000
  )
  for (const app of parseAtspiObjectRefs(rootOutput)) {
    const appName = parseAtspiString(callAtspi(
      address,
      app.bus,
      "/org/a11y/atspi/accessible/root",
      "org.freedesktop.DBus.Properties.Get",
      ["org.a11y.atspi.Accessible", "Name"]
    ))
    const childrenOutput = callAtspi(address, app.bus, app.path, "org.a11y.atspi.Accessible.GetChildren")
    for (const child of parseAtspiObjectRefs(childrenOutput)) {
      if (!isAtspiTerminalWindow(appName, child.path)) continue
      const role = getAtspiWindowRole(address, child)?.toLowerCase() ?? null
      if (isAtspiWindowRoleAccepted(role)) {
        refs.push(child)
      }
    }
  }
  return refs
}

export function getGnomeAtspiActiveWindowKey(): string | null {
  try {
    const address = getAtspiBusAddress()
    if (!address) return null
    for (const ref of getAtspiTerminalWindowRefs(address)) {
      if (isAtspiWindowActive(address, ref) === true) {
        // AT-SPI object paths are only unique within their D-Bus bus name
        // (e.g. every app exposes `/org/a11y/atspi/accessible/1`), so the
        // key must include the bus name to stay globally unique across
        // terminal processes. `@` appears in neither alphabet, keeping the
        // split unambiguous (unlike `:` — bus names look like `:1.10`).
        return `atspi:${ref.bus}@${ref.path}`
      }
    }
    return null
  } catch {
    return null
  }
}

const GNOME_BRIDGE_INTERFACE = "org.gnome.Shell.Extensions.OpenCodeNotifier"
const GNOME_BRIDGE_PATH = "/org/gnome/Shell/Extensions/OpenCodeNotifier"

function callGnomeBridge(method: "CaptureWindow" | "ActivateWindow", args: readonly string[] = []): string | null {
  return execFileWithTimeout("gdbus", [
    "call", "--session", "--dest", "org.gnome.Shell", "--object-path", GNOME_BRIDGE_PATH,
    "--method", `${GNOME_BRIDGE_INTERFACE}.${method}`, ...args,
  ], 1000)
}

function getGnomeShellWindowKey(): string | null {
  const id = parseAtspiString(callGnomeBridge("CaptureWindow"))
  return id && /^[0-9a-f-]{36}:\d+$/.test(id) ? `gnome:${id}` : null
}

export function isTerminalJumpBackSupported(): boolean {
  if (isKDEJumpBackSupported()) return !!(getPinnedKDEWindowId() ?? cachedWindowId)
  return process.platform === "linux" && !!process.env.WAYLAND_DISPLAY && isGnomeLikeSession()
    && !!cachedWindowId?.startsWith("gnome:")
}

export function debugFocusState(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) {
    console.error(`[opencode-notifier] ${message}`)
  }
}

function isWindowsHostFocused(): boolean {
  const { focused, reason, output } = getWindowsFocus()
  debugFocusState(`windows focus: ${reason} focused=${focused} probe=${output ?? "null"}`)
  return focused
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

export function buildOsascriptActivateAppArgs(appName: string): string[] {
  const escapedAppName = appName
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')

  return [
    "-e",
    `tell application "${escapedAppName}" to activate`,
  ]
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
    if (process.env.DISPLAY) return firstNumericWindowId(execWithTimeout("xdotool getactivewindow"))
    return null
  }
  if (platform === "win32") return null
  return null
}

// KDE capture is awaited by the terminal's setup. Import-time foreground
// capture can belong to another app when clients start or reload in background.
let cachedWindowId: string | null =
  process.platform === "linux" && process.env.KDE_SESSION_VERSION
    ? null
    : getActiveWindowId()

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

export function isZellijPaneFocused(paneID: string | null | undefined, clientsOutput: string | null): boolean {
  if (!paneID || !clientsOutput) return false
  const match = /^(?:terminal_)?(\d+)$/.exec(paneID)
  if (!match) return false
  const target = `terminal_${match[1]}`
  return clientsOutput.split(/\r?\n/).some(line => {
    const fields = line.trim().split(/\s+/)
    return /^\d+$/.test(fields[0]) && fields[1] === target
  })
}

function isZellijPaneActive(): boolean {
  const session = process.env.ZELLIJ_SESSION_NAME
  const pane = process.env.ZELLIJ_PANE_ID
  if (!session || !pane) return false
  return isZellijPaneFocused(pane, execFileWithTimeout("zellij", ["--session", session, "action", "list-clients"], 1000))
}

export function isLinuxTerminalFocused(params: {
  cachedWindowId: string | null
  currentWindowId: string | null
  wezTermPaneActive: boolean
  tmuxPaneActive: boolean | null
  zellijPaneActive?: boolean | null
}): boolean {
  const { cachedWindowId, currentWindowId, wezTermPaneActive, tmuxPaneActive, zellijPaneActive } = params
  if (zellijPaneActive === false) return false

  if (!cachedWindowId) {
    if (!wezTermPaneActive) return false
    if (tmuxPaneActive !== null) return tmuxPaneActive
    if (zellijPaneActive != null) return zellijPaneActive
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
    const zellijPaneActive = process.env.ZELLIJ_SESSION_NAME || process.env.ZELLIJ_PANE_ID ? isZellijPaneActive() : null
    if (zellijPaneActive === false) return false
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

    if (process.platform === "win32") return isWindowsHostFocused()

    const tmuxPaneActive = process.env.TMUX ? isTmuxPaneActive() : null
    const currentWindowId = getActiveWindowId()
    const focused = isLinuxTerminalFocused({
      cachedWindowId,
      currentWindowId,
      wezTermPaneActive: isWezTermPaneActive(),
      tmuxPaneActive,
      zellijPaneActive,
    })
    debugFocusState(
      `linux focus: backend=${getLinuxFocusBackendName()} session=${process.env.XDG_SESSION_TYPE ?? "?"} desktop=${process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? "?"} cached=${cachedWindowId ?? "null"} current=${currentWindowId ?? "null"} tmux=${String(tmuxPaneActive)} zellij=${String(zellijPaneActive)} focused=${focused}`
    )
    return focused
  } catch {
    return false
  }
}

function getWindowIdFromXdotool(searchTerm: string): string | null {
  return firstNumericWindowId(execFileWithTimeout("xdotool", ["search", "--classname", searchTerm]))
}

function getWindowIdFromKdotool(searchTerm: string): string | null {
  return firstKDEWindowId(execFileWithTimeout("kdotool", ["search", "--classname", searchTerm]))
}

function getWindowTitleFromKdotool(windowId: string): string | null {
  if (!isKDEWindowId(windowId)) return null
  return execFileWithTimeout("kdotool", ["getwindowname", windowId])
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
  if (!isNumericWindowId(windowId)) return null

  const output = execFileWithTimeout("xprop", ["-id", windowId, "WM_CLASS"])
  if (!output) return null

  const matches = [...output.matchAll(/"([^"]*)"/g)].map((match) => match[1])
  return matches[1] ?? matches[0] ?? null
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
    if (isKDE) {
      return cachedId
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
  if (!isNumericWindowId(windowId)) return

  try {
    execFileSync("xdotool", ["windowactivate", windowId], { timeout: 1000, stdio: "ignore" })
  } catch {
  }
}

const LINUX_EMBEDDED_TERMINAL_APPS = new Set(["code", "code-insiders", "code-oss", "codium", "cursor", "obsidian", "zed"])

function getLinuxHostProcessIDs(): number[] {
  const hosts: number[] = []
  const seen = new Set<number>()
  let pid = process.pid
  for (let depth = 0; depth < 32 && pid > 1 && !seen.has(pid); depth++) {
    seen.add(pid)
    try {
      const name = readFileSync(`/proc/${pid}/comm`, "utf-8").trim().toLowerCase()
      if (LINUX_TERMINAL_APPS.has(name) || LINUX_EMBEDDED_TERMINAL_APPS.has(name) || name === "gnome-terminal-") hosts.push(pid)
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8")
      // comm can contain spaces and parentheses; fields after its closing ')'
      // start with the state and parent PID.
      const parent = Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[1])
      if (!Number.isInteger(parent) || parent <= 0) break
      pid = parent
    } catch { break }
  }
  return hosts
}

function expectedLinuxHostClasses(termProgram: string | undefined): string[] {
  const term = termProgram?.toLowerCase() ?? ""
  if (term === "vscode") return ["code", "code-insiders", "code-oss", "vscodium", "codium"]
  if (LINUX_TERMINAL_APPS.has(term) || LINUX_EMBEDDED_TERMINAL_APPS.has(term)) return [term]
  return []
}

async function getKDEStartupWindowId(): Promise<string | null> {
  const pinned = getPinnedKDEWindowId()
  if (pinned) return pinned
  const active = firstKDEWindowId(await execFileAsync("kdotool", ["getactivewindow"]))
  const hosts = getLinuxHostProcessIDs()
  for (const pid of hosts) {
    // kdotool defaults to OR. With an empty title pattern, --pid alone returns
    // every window; --all is required for an actual process ownership check.
    const output = await execFileAsync("kdotool", ["search", "--all", "--pid", String(pid)])
    const ids = [...new Set(output?.split(/\s+/).filter(isKDEWindowId) ?? [])]
    if (ids.length === 1) {
      debugFocusState(`KDE captured host window=${ids[0]} pid=${pid}`)
      return ids[0]
    }
    if (ids.length > 1) {
      const result = active && ids.includes(active) ? active : null
      debugFocusState(`KDE ambiguous host pid=${pid} windows=${ids.length} captured=${result ?? "null"}`)
      return result
    }
  }
  if (hosts.length) {
    debugFocusState("KDE startup capture skipped: host ancestors have no matching window")
    return null
  }
  // Embedded launchers across sandbox boundaries can lose their host ancestry.
  // Preserve focused-startup capture there, but never accept a different app
  // when a known TERM_PROGRAM tells us which host to expect.
  if (!active) return null
  const expected = expectedLinuxHostClasses(process.env.TERM_PROGRAM)
  if (expected.length) {
    const className = (await execFileAsync("kdotool", ["getwindowclassname", active]))?.toLowerCase().split(".").pop()
    if (!className || !expected.includes(className)) return null
  }
  debugFocusState(`KDE captured startup foreground window=${active} (host ancestry unavailable)`)
  return active
}

let cachedQdbusBinary: string | null | undefined

// Fedora ships Qt's D-Bus tooling under versioned names (e.g. `qdbus-qt6`)
// while other distros expose a plain `qdbus`. Resolve once and cache.
const QDBUS_CANDIDATES = ["qdbus-qt6", "qdbus6", "qdbus-qt5", "qdbus5", "qdbus"]

function isExecutableOnPath(name: string): boolean {
  const pathEnv = process.env.PATH ?? ""
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const full = join(dir, name)
    try {
      accessSync(full, constants.X_OK)
      if (statSync(full).isFile()) return true
    } catch {}
  }
  return false
}

export function findQdbusBinary(
  candidates: readonly string[] = QDBUS_CANDIDATES,
  isExecutable: (name: string) => boolean = isExecutableOnPath
): string | null {
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate
    }
  }
  return null
}

export function resolveQdbusBinary(): string | null {
  if (cachedQdbusBinary !== undefined) {
    return cachedQdbusBinary
  }

  cachedQdbusBinary = findQdbusBinary()
  return cachedQdbusBinary
}

async function focusKDEWindow(): Promise<void> {
  const id = getPinnedKDEWindowId() ?? cachedWindowId
  if (!id || !isKDEWindowId(id)) {
    debugFocusState("KDE jump-back skipped: originating window is unknown")
    return
  }
  const result = await execFileAsync("kdotool", ["windowactivate", id], 1500)
  debugFocusState(`KDE jump-back window=${id} ${result === null ? "failed; no other window selected" : "activated"}`)
}

function focusLinuxWindowHyprland(windowId: string): void {
  if (!isSafeCompositorWindowId(windowId)) return

  // Lua configs (Hyprland 0.55+) reject the legacy dispatch with a non-zero exit, so retry with the hl.dsp form.
  try {
    execFileSync("hyprctl", ["dispatch", "focuswindow", `address:${windowId}`], { timeout: 1000, stdio: "ignore" })
  } catch {
    try {
      execFileSync("hyprctl", ["dispatch", `hl.dsp.focus({ window = "address:${windowId}" })`], { timeout: 1000, stdio: "ignore" })
    } catch {
    }
  }
}

function focusLinuxWindowSway(windowId: string): void {
  if (!isNumericWindowId(windowId)) return

  try {
    execFileSync("swaymsg", [`[con_id=${windowId}] focus`], { timeout: 1000, stdio: "ignore" })
  } catch {
  }
}

function focusLinuxWindowNiri(windowId: string): void {
  if (!isNumericWindowId(windowId)) return

  try {
    execFileSync("niri", ["msg", "action", "focus-window", "--id", windowId], { timeout: 1000, stdio: "ignore" })
  } catch {
  }
}

let startupWindowCapture: Promise<void> | undefined

export async function captureStartupWindowId(): Promise<void> {
  if (process.platform !== "linux" || !process.env.KDE_SESSION_VERSION) return
  startupWindowCapture ??= (async () => {
    cachedKDEJumpBackSupport = await execFileAsync("kdotool", ["--help"], 1000) !== null
    if (!cachedKDEJumpBackSupport) return
    cachedWindowId = await getKDEStartupWindowId()
    cachedWindowTitleValue = undefined
    // Do not write an automatically captured ID into process.env. It can be
    // inherited by another client or mistaken for a user override on reload.
    debugFocusState(`KDE startup capture=${cachedWindowId ?? "null"}`)
  })().catch(error => debugFocusState(`KDE startup capture failed: ${String(error)}`))
  await startupWindowCapture
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
          execFileSync("osascript", buildOsascriptActivateAppArgs(app), { timeout: 1000, stdio: "ignore" })
          return
        } catch {
        }
      }
      execFileSync("osascript", buildOsascriptActivateAppArgs("Terminal"), { timeout: 1000, stdio: "ignore" })
    } catch {
    }
    return
  }

  if (process.platform === "linux") {
    const env = process.env
    if (env.WAYLAND_DISPLAY && isGnomeLikeSession(env) && cachedWindowId?.startsWith("gnome:")) {
      const result = callGnomeBridge("ActivateWindow", [cachedWindowId.slice("gnome:".length)])
      debugFocusState(`GNOME jump-back ActivateWindow ${cachedWindowId} -> ${result ?? "null"}`)
      if (result !== "(true,)") debugFocusState("GNOME jump-back could not activate the captured window")
      return
    }
    
    // KDE uses the same captured host identity on X11 and Wayland.
    if (env.KDE_SESSION_VERSION) {
      await focusKDEWindow()
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
