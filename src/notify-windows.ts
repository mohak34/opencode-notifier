import { execFile } from "child_process"
import { pathToFileURL } from "url"
import type { WindowsScenario } from "./config"

// Windows ignores scenario="reminder" unless the toast contains at least one
// background action, so the reminder carries an explicit dismiss button.
const REMINDER_ACTIONS = '<actions><action content="Dismiss" arguments="dismiss" activationType="background"/></actions>'

// Bounds how long a broken PowerShell can delay the fallback toast.
const POWERSHELL_TIMEOUT_MS = 5000

// Windows shows this name in notification settings; the configurable appID
// stays the identity.
const WINDOWS_TOAST_DISPLAY_NAME = "OpenCode"

export interface WindowsToastRequest {
  title: string
  message: string
  iconPath?: string
  appID: string
  wsl: boolean
}

export interface WindowsToastPayload {
  appId: string
  displayName: string
  iconPath: string | null
  xml: string
}

function debug(message: string): void {
  if (process.env.OPENCODE_NOTIFIER_DEBUG) console.error(`[opencode-notifier] ${message}`)
}

// XML 1.0 text cannot carry most C0 controls. Strip them before escaping so a
// session title cannot make LoadXml fail.
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// Drive-letter and, on WSL, /mnt/<drive> paths are the only ones Windows can
// read. Everything else is dropped instead of producing an unreadable URI.
function toWindowsDrivePath(value: string, wsl: boolean): string | null {
  const normalized = value.replace(/\\/g, "/")
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (drive) return `${drive[1].toUpperCase()}:/${drive[2]}`

  const wslDrive = normalized.match(/^\/mnt\/([a-z])\/(.*)$/i)
  if (wsl && wslDrive) return `${wslDrive[1].toUpperCase()}:/${wslDrive[2]}`

  return null
}

// Toast images need a Windows file URI. Unsupported paths drop the icon.
export function toWindowsFileUri(iconPath: string | undefined, wsl: boolean): string | null {
  const value = iconPath?.trim()
  if (!value) return null

  const drivePath = toWindowsDrivePath(value, wsl)
  if (drivePath) {
    const [drive, ...segments] = drivePath.split("/")
    return `file:///${drive}/${segments.map(segment => encodeURIComponent(segment)).join("/")}`
  }

  if (!wsl && value.replace(/\\/g, "/").startsWith("/")) {
    try {
      return pathToFileURL(value).href
    } catch {
      return null
    }
  }

  return null
}

// The AUMID registration stores a Windows path, not a file URI.
export function toWindowsIconPath(iconPath: string | undefined, wsl: boolean): string | null {
  const value = iconPath?.trim()
  if (!value) return null

  const drivePath = toWindowsDrivePath(value, wsl)
  if (drivePath) return drivePath

  if (!wsl && value.replace(/\\/g, "/").startsWith("/")) return value

  return null
}

export function buildWindowsToastXml(
  title: string,
  message: string,
  iconUri: string | null,
  scenario: WindowsScenario
): string {
  const image = iconUri
    ? `<image placement="appLogoOverride" hint-crop="none" src="${escapeXml(iconUri)}"/>`
    : ""
  const scenarioAttribute = scenario === "default" ? "" : ` scenario="${scenario}"`
  const actions = scenario === "reminder" ? REMINDER_ACTIONS : ""
  return `<toast${scenarioAttribute}><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(message)}</text>${image}</binding></visual>${actions}</toast>`
}

export function buildWindowsToastPayload(
  request: WindowsToastRequest,
  scenario: WindowsScenario
): WindowsToastPayload {
  return {
    appId: request.appID,
    displayName: WINDOWS_TOAST_DISPLAY_NAME,
    iconPath: toWindowsIconPath(request.iconPath, request.wsl),
    xml: buildWindowsToastXml(request.title, request.message, toWindowsFileUri(request.iconPath, request.wsl), scenario),
  }
}

// New-Item -Force deletes an existing key, and appID may belong to another app,
// so a registered ID is left alone. DisplayName is written last to mark a
// complete registration.
export function buildWindowsToastScript(payload: WindowsToastPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return `$ErrorActionPreference = 'Stop'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$appKey = "HKCU:\\Software\\Classes\\AppUserModelId\\$($payload.appId)"
$registered = Get-ItemProperty -LiteralPath $appKey -ErrorAction SilentlyContinue
if ($null -eq $registered.DisplayName) {
  if (-not (Test-Path -LiteralPath $appKey)) { New-Item -Path $appKey -Force | Out-Null }
  if ($payload.iconPath) { Set-ItemProperty -LiteralPath $appKey -Name IconUri -Value $payload.iconPath }
  Set-ItemProperty -LiteralPath $appKey -Name DisplayName -Value $payload.displayName
}
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($payload.xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($payload.appId).Show($toast)`
}

// Returns false when PowerShell is unavailable or the toast cannot be shown.
// The caller then falls back to the regular transient toast.
export function sendWindowsReminderNotification(request: WindowsToastRequest): Promise<boolean> {
  const payload = buildWindowsToastPayload(request, "reminder")
  const script = buildWindowsToastScript(payload)
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  // WinRT toast classes are only available in Windows PowerShell 5.1, not pwsh.
  const command = request.wsl ? "powershell.exe" : "powershell"

  return new Promise((resolve) => {
    const finish = (error: unknown) => {
      if (error) debug(`reminder toast failed: ${String(error)}`)
      resolve(!error)
    }
    try {
      execFile(
        command,
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
        finish
      )
    } catch (error) {
      // An oversized command line throws instead of reaching the callback.
      finish(error)
    }
  })
}

// Reminders are opt-in and best-effort: the default scenario, a failed
// reminder and an unavailable PowerShell all end at the regular toast.
export async function deliverWindowsNotification(
  scenario: WindowsScenario,
  request: WindowsToastRequest,
  sendDefault: () => Promise<void>
): Promise<void> {
  if (scenario === "reminder" && await sendWindowsReminderNotification(request)) return
  await sendDefault()
}
