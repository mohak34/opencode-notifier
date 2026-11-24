import { execFile } from "child_process"
import { pathToFileURL } from "url"
import type { WindowsScenario } from "./config"

// Windows ignores scenario="reminder" unless the toast contains at least one
// background action, so the reminder carries an explicit dismiss button.
const REMINDER_ACTIONS = '<actions><action content="Dismiss" arguments="dismiss" activationType="background"/></actions>'

const POWERSHELL_TIMEOUT_MS = 5000

export interface WindowsToastPayload {
  appId: string
  displayName: string
  iconPath: string | null
  xml: string
}

const WINDOWS_APP_DISPLAY_NAME = "OpenCode"

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

// Toast images need a Windows file URI. WSL runs this code on Linux, where
// pathToFileURL would produce a Linux path Windows cannot read, so drive
// paths are converted explicitly. Unsupported paths drop the icon.
export function toWindowsFileUri(iconPath: string | undefined, wsl: boolean): string | null {
  const value = iconPath?.trim()
  if (!value) return null

  const normalized = value.replace(/\\/g, "/")
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (drive) {
    const segments = drive[2].split("/").map(segment => encodeURIComponent(segment))
    return `file:///${drive[1].toUpperCase()}:/${segments.join("/")}`
  }

  if (!wsl && normalized.startsWith("/")) {
    try {
      return pathToFileURL(value).href
    } catch {
      return null
    }
  }

  return null
}

// The AUMID registration stores a Windows path, not a file URI. WSL paths
// under /mnt/<drive> are translated so Windows can read the icon.
export function toWindowsIconPath(iconPath: string | undefined, wsl: boolean): string | null {
  const value = iconPath?.trim()
  if (!value) return null

  const normalized = value.replace(/\\/g, "/")
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (drive) return `${drive[1].toUpperCase()}:/${drive[2]}`

  const wslDrive = normalized.match(/^\/mnt\/([a-z])\/(.*)$/i)
  if (wsl && wslDrive) return `${wslDrive[1].toUpperCase()}:/${wslDrive[2]}`

  if (!wsl && normalized.startsWith("/")) return value

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
  title: string,
  message: string,
  iconPath: string | undefined,
  appID: string,
  scenario: WindowsScenario,
  wsl: boolean
): WindowsToastPayload {
  return {
    appId: appID,
    displayName: WINDOWS_APP_DISPLAY_NAME,
    iconPath: toWindowsIconPath(iconPath, wsl),
    xml: buildWindowsToastXml(title, message, toWindowsFileUri(iconPath, wsl), scenario),
  }
}

export function buildWindowsToastScript(payload: WindowsToastPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return `$ErrorActionPreference = 'Stop'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$appKey = "HKCU:\\Software\\Classes\\AppUserModelId\\$($payload.appId)"
$registered = Get-ItemProperty -Path $appKey -ErrorAction SilentlyContinue
$needsIcon = $payload.iconPath -and ($null -eq $registered -or $registered.IconUri -ne $payload.iconPath)
if ($null -eq $registered -or $registered.DisplayName -ne $payload.displayName -or $needsIcon) {
  New-Item -Path $appKey -Force | Out-Null
  Set-ItemProperty -Path $appKey -Name DisplayName -Value $payload.displayName
  if ($payload.iconPath) {
    Set-ItemProperty -Path $appKey -Name IconUri -Value $payload.iconPath
  }
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
export function sendWindowsReminderNotification(
  title: string,
  message: string,
  iconPath: string | undefined,
  appID: string,
  wsl: boolean
): Promise<boolean> {
  const payload = buildWindowsToastPayload(title, message, iconPath, appID, "reminder", wsl)
  const script = buildWindowsToastScript(payload)
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  // WinRT toast classes are only available in Windows PowerShell 5.1, not pwsh.
  const command = wsl ? "powershell.exe" : "powershell"

  return new Promise((resolve) => {
    execFile(
      command,
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error) debug(`reminder toast failed: ${String(error)}`)
        resolve(!error)
      }
    )
  })
}
