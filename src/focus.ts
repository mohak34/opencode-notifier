import { execFile, execFileSync, execSync } from "child_process"
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { delimiter, join } from "path"

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

function isNumericWindowId(value: string): boolean {
  return /^\d+$/.test(value)
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
  if (env.KDE_SESSION_VERSION) return firstNumericWindowId(execWithTimeout("kdotool getactivewindow"))
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
  if (isKDEJumpBackSupported()) return true
  return process.platform === "linux" && !!process.env.WAYLAND_DISPLAY && isGnomeLikeSession()
    && !!cachedWindowId?.startsWith("gnome:")
}

export function debugFocusState(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) {
    console.error(`[opencode-notifier] ${message}`)
  }
}

// Windows focus is decided against the console OpenCode is attached to, not
// against a list of terminal class names. Windows Terminal and conhost own
// that console's window, so a handle compare tells our window from any other
// terminal or editor. Hosts that leave the ConPTY window unowned (VS Code,
// WezTerm, Alacritty) fall back to "the foreground window's process is one of
// our ancestors". Prints "focused", "other", "none" or "noconsole"; any error
// stops the script before a verdict, which fails open.
export function buildWindowsFocusScript(pid: number): string {
  return `
$ErrorActionPreference='Stop'
$k=Add-Type -Name Focus -Namespace OpenCodeNotifier -PassThru -MemberDefinition '
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint p);
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);'
$fg=$k::GetForegroundWindow()
if($fg -eq [IntPtr]::Zero){'none';return}
[void]$k::FreeConsole()
if(-not $k::AttachConsole(${pid})){'noconsole';return}
$c=$k::GetConsoleWindow()
$root=$k::GetAncestor($c,3)
if($root -ne [IntPtr]::Zero -and $fg -eq $root){'focused';return}
if($root -ne $c -or ($c -ne [IntPtr]::Zero -and $k::IsWindowVisible($c))){'other';return}
$fp=[uint32]0
[void]$k::GetWindowThreadProcessId($fg,[ref]$fp)
$parents=@{}
Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId|%{$parents[[int]$_.ProcessId]=[int]$_.ParentProcessId}
$p=${pid};$seen=@{}
while($p -and -not $seen[$p]){if($p -eq $fp){'focused';return};$seen[$p]=1;$p=$parents[$p]}
'other'
`.trim()
}

// PowerShell may print CLIXML or warnings around the verdict; only an exact
// "focused" line counts. Anything else fails open so the alert is delivered.
export function parseWindowsFocusOutput(output: string | null): boolean {
  return !!output?.split(/\r?\n/).some(line => line.trim() === "focused")
}

function isWindowsConsoleFocused(): boolean {
  const encoded = Buffer.from(buildWindowsFocusScript(process.pid), "utf16le").toString("base64")
  const args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]
  const output = execFileWithTimeout("powershell", args, 5000) ?? execFileWithTimeout("pwsh", args, 5000)
  const focused = parseWindowsFocusOutput(output)
  debugFocusState(`windows focus: pid=${process.pid} result=${output ?? "null"} focused=${focused}`)
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

    if (process.platform === "win32") return isWindowsConsoleFocused()

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
  return firstNumericWindowId(execFileWithTimeout("kdotool", ["search", "--classname", searchTerm]))
}

function getWindowTitleFromKdotool(windowId: string): string | null {
  if (!isNumericWindowId(windowId)) return null
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
  if (!isNumericWindowId(windowId)) return

  try {
    execFileSync("xdotool", ["windowactivate", windowId], { timeout: 1000, stdio: "ignore" })
  } catch {
  }
}

function focusLinuxWindowKDE(windowId: string): void {
  if (!isNumericWindowId(windowId)) return

  try {
    const result = firstNumericWindowId(execWithTimeout("kdotool getactivewindow"))
    if (result === windowId) return
    execFileSync("kdotool", ["windowactivate", windowId], { timeout: 1000, stdio: "ignore" })
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

function focusKDEWithKWinScript(): void {
  try {
    const pinnedWindowId = process.env.OPENCODE_NOTIFIER_WINDOW_ID?.trim() || null
    if (pinnedWindowId && isNumericWindowId(pinnedWindowId)) {
      try {
        execFileSync("kdotool", ["windowactivate", pinnedWindowId], { timeout: 1500, stdio: "ignore" })
        return
      } catch {
      }
    }

    if (cachedWindowId && isNumericWindowId(cachedWindowId)) {
      try {
        execFileSync("kdotool", ["windowactivate", cachedWindowId], { timeout: 1500, stdio: "ignore" })
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
    
    const pluginName = `opencode-focus-${currentPid}`
    let scriptDirectory: string | null = null
    let scriptPath: string | null = null
    let scriptLoaded = false

    const cleanupScript = () => {
      if (!scriptPath || !scriptDirectory) return
      try {
        rmSync(scriptPath, { force: true })
      } catch {}
      try {
        rmSync(scriptDirectory, { recursive: true, force: true })
      } catch {}
    }

    const qdbus = resolveQdbusBinary()
    if (!qdbus) {
      throw new Error("qdbus not found")
    }

    try {
      scriptDirectory = mkdtempSync(join(tmpdir(), "opencode-focus-"))
      scriptPath = join(scriptDirectory, "script.kwinscript")
      writeFileSync(scriptPath, scriptContent, { encoding: "utf-8", mode: 0o600, flag: "wx" })

      execFileSync(
        qdbus,
        ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", scriptPath, pluginName],
        { encoding: "utf-8", timeout: 2000, stdio: "ignore" }
      )
      scriptLoaded = true

      execFileSync(qdbus, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.start"], {
        timeout: 2000,
        stdio: "ignore",
      })

      cleanupScript()

      setTimeout(() => {
        try {
          execFileSync(qdbus, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", pluginName], {
            timeout: 500,
            stdio: "ignore",
          })
        } catch {}
      }, 1000)
    } catch {
      if (scriptLoaded) {
        try {
          execFileSync(qdbus, ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", pluginName], {
            timeout: 500,
            stdio: "ignore",
          })
        } catch {}
      }
      cleanupScript()
      throw new Error("Unable to activate the terminal through KWin")
    }

  } catch {
    // Fall back to xdotool
    try {
      const cachedId = cachedWindowId;
      if (cachedId && isNumericWindowId(cachedId)) {
        execFileSync("xdotool", ["windowactivate", cachedId], { timeout: 1000, stdio: "ignore" })
      }
    } catch {}
  }
}

function focusLinuxWindowHyprland(windowId: string): void {
  if (!isSafeCompositorWindowId(windowId)) return

  try {
    execFileSync("hyprctl", ["dispatch", "focuswindow", `address:${windowId}`], { timeout: 1000, stdio: "ignore" })
  } catch {
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
      if (result !== "(true,)") debugFocusState("GNOME jump-back could not activate the captured window")
      return
    }
    
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
