import { execFile } from "child_process"

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
// read. Everything else drops the icon. The AUMID registration takes this path.
export function toWindowsIconPath(iconPath: string | undefined, wsl: boolean): string | null {
  const normalized = iconPath?.trim().replace(/\\/g, "/") ?? ""
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/) ?? (wsl ? normalized.match(/^\/mnt\/([a-z])\/(.*)$/i) : null)
  return match ? `${match[1].toUpperCase()}:/${match[2]}` : null
}

// Toast images need a file URI.
export function toWindowsFileUri(windowsPath: string | null): string | null {
  if (!windowsPath) return null
  const [drive, ...segments] = windowsPath.split("/")
  return `file:///${drive}/${segments.map(encodeURIComponent).join("/")}`
}

export function buildWindowsToastXml(title: string, message: string, iconUri: string | null): string {
  const image = iconUri
    ? `<image placement="appLogoOverride" hint-crop="none" src="${escapeXml(iconUri)}"/>`
    : ""
  return `<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(message)}</text>${image}</binding></visual>${REMINDER_ACTIONS}</toast>`
}

export function buildWindowsToastPayload(request: WindowsToastRequest): WindowsToastPayload {
  const iconPath = toWindowsIconPath(request.iconPath, request.wsl)
  return {
    appId: request.appID,
    displayName: WINDOWS_TOAST_DISPLAY_NAME,
    iconPath,
    xml: buildWindowsToastXml(request.title, request.message, toWindowsFileUri(iconPath)),
  }
}

// appID may belong to another app and several terminals may register at once.
// CreateSubKey opens an existing key without changing it (New-Item -Force would
// delete it), and DisplayName is written last to mark a complete registration.
export function buildWindowsToastScript(payload: WindowsToastPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return `$ErrorActionPreference = 'Stop'
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\\Classes\\AppUserModelId\\$($payload.appId)")
if ($null -eq $key.GetValue('DisplayName')) {
  if ($payload.iconPath) { $key.SetValue('IconUri', $payload.iconPath) }
  $key.SetValue('DisplayName', $payload.displayName)
}
$key.Close()
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
  return new Promise((resolve) => {
    const finish = (error: unknown) => {
      if (error) debug(`reminder toast failed: ${String(error)}`)
      resolve(!error)
    }
    try {
      const script = buildWindowsToastScript(buildWindowsToastPayload(request))
      const encoded = Buffer.from(script, "utf16le").toString("base64")
      // WinRT toast classes are only available in Windows PowerShell 5.1, not pwsh.
      execFile(
        request.wsl ? "powershell.exe" : "powershell",
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
