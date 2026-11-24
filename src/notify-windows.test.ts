import { describe, test, expect } from "bun:test"
import {
  buildWindowsToastPayload,
  buildWindowsToastScript,
  buildWindowsToastXml,
  escapeXml,
  toWindowsFileUri,
  toWindowsIconPath,
} from "./notify-windows"

describe("escapeXml", () => {
  test("escapes XML entities", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;")
  })

  test("strips control characters that XML cannot carry but keeps tabs and newlines", () => {
    expect(escapeXml("a\u0000b\u0008c\td\ne\rf")).toBe("abc\td\ne\rf")
  })
})

describe("toWindowsFileUri", () => {
  test("converts a Windows drive path", () => {
    expect(toWindowsFileUri("C:\\Users\\Me\\logo.png", false)).toBe("file:///C:/Users/Me/logo.png")
  })

  test("encodes spaces and keeps forward slashes", () => {
    expect(toWindowsFileUri("C:/Program Files/logo.png", false)).toBe("file:///C:/Program%20Files/logo.png")
  })

  test("translates a WSL mounted Windows path", () => {
    expect(toWindowsFileUri("/mnt/c/Users/Me/logo.png", true)).toBe("file:///C:/Users/Me/logo.png")
  })

  test("returns null for a WSL filesystem path Windows cannot read", () => {
    expect(toWindowsFileUri("/home/me/.cache/logo.png", true)).toBeNull()
  })

  test("returns null when there is no icon", () => {
    expect(toWindowsFileUri(undefined, false)).toBeNull()
  })
})

describe("toWindowsIconPath", () => {
  test("normalizes a Windows drive path for the AUMID registry entry", () => {
    expect(toWindowsIconPath("C:\\Users\\Me\\logo.png", false)).toBe("C:/Users/Me/logo.png")
  })

  test("translates a WSL mounted Windows path", () => {
    expect(toWindowsIconPath("/mnt/c/Users/Me/logo.png", true)).toBe("C:/Users/Me/logo.png")
  })

  test("drops a WSL filesystem path Windows cannot read", () => {
    expect(toWindowsIconPath("/home/me/.cache/logo.png", true)).toBeNull()
  })
})

describe("buildWindowsToastXml", () => {
  test("adds reminder scenario and the background action Windows requires", () => {
    const xml = buildWindowsToastXml("OpenCode", "Session finished", null, "reminder")

    expect(xml).toContain('<toast scenario="reminder">')
    expect(xml).toContain('<action content="Dismiss" arguments="dismiss" activationType="background"/>')
    expect(xml).toContain("<text>OpenCode</text>")
    expect(xml).toContain("<text>Session finished</text>")
    expect(xml).not.toContain("<image")
  })

  test("omits scenario and actions for the default toast", () => {
    const xml = buildWindowsToastXml("OpenCode", "Session finished", null, "default")

    expect(xml).not.toContain("scenario=")
    expect(xml).not.toContain("<actions>")
  })

  test("includes an escaped app logo URI", () => {
    const xml = buildWindowsToastXml("A & B", "done", "file:///C:/icon%20a&b.png", "reminder")

    expect(xml).toContain('src="file:///C:/icon%20a&amp;b.png"')
    expect(xml).toContain("<text>A &amp; B</text>")
  })
})

describe("buildWindowsToastPayload", () => {
  test("carries the app id, display name, icon path and XML for the PowerShell script", () => {
    const payload = buildWindowsToastPayload(
      { title: "OpenCode", message: "done", iconPath: "C:\\icon.png", appID: "opencode", wsl: false },
      "reminder"
    )

    expect(payload.appId).toBe("opencode")
    expect(payload.displayName).toBe("OpenCode")
    expect(payload.iconPath).toBe("C:/icon.png")
    expect(payload.xml).toContain('scenario="reminder"')
    expect(payload.xml).toContain("file:///C:/icon.png")
  })
})

describe("buildWindowsToastScript", () => {
  test("registers the AppUserModelID before showing the toast", () => {
    const payload = {
      appId: "opencode",
      displayName: "OpenCode",
      iconPath: "C:/icon.png",
      xml: '<toast scenario="reminder"/>',
    }
    const script = buildWindowsToastScript(payload)
    const encoded = script.match(/FromBase64String\('([^']+)'\)/)?.[1]

    expect(encoded).toBeString()
    expect(JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"))).toEqual(payload)
    expect(script).toContain("Software\\Classes\\AppUserModelId")
    expect(script).toContain("if (-not (Test-Path -LiteralPath $appKey)) { New-Item")
    expect(script).toContain("-Name IconUri")
    expect(script.indexOf("-Name DisplayName")).toBeGreaterThan(script.indexOf("-Name IconUri"))
    expect(script).not.toContain("Remove-ItemProperty")
    expect(script).toContain("Windows.UI.Notifications.ToastNotificationManager")
    expect(script).toContain("CreateToastNotifier($payload.appId).Show($toast)")
  })
})
