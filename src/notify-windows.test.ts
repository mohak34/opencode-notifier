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

describe("toWindowsIconPath", () => {
  test("normalizes a Windows drive path", () => {
    expect(toWindowsIconPath("c:\\Users\\Me\\logo.png", false)).toBe("C:/Users/Me/logo.png")
  })

  test("translates a WSL mounted Windows path", () => {
    expect(toWindowsIconPath("/mnt/c/Users/Me/logo.png", true)).toBe("C:/Users/Me/logo.png")
  })

  test("drops a path Windows cannot read, and a missing icon", () => {
    expect(toWindowsIconPath("/home/me/.cache/logo.png", true)).toBeNull()
    expect(toWindowsIconPath("/mnt/c/logo.png", false)).toBeNull()
    expect(toWindowsIconPath(undefined, false)).toBeNull()
  })
})

describe("toWindowsFileUri", () => {
  test("encodes spaces and keeps the drive and separators", () => {
    expect(toWindowsFileUri("C:/Program Files/logo.png")).toBe("file:///C:/Program%20Files/logo.png")
  })

  test("returns null without an icon", () => {
    expect(toWindowsFileUri(null)).toBeNull()
  })
})

describe("buildWindowsToastXml", () => {
  test("adds reminder scenario and the background action Windows requires", () => {
    const xml = buildWindowsToastXml("OpenCode", "Session finished", null)

    expect(xml).toContain('<toast scenario="reminder">')
    expect(xml).toContain('<action content="Dismiss" arguments="dismiss" activationType="background"/>')
    expect(xml).toContain("<text>OpenCode</text>")
    expect(xml).toContain("<text>Session finished</text>")
    expect(xml).not.toContain("<image")
  })

  test("includes an escaped app logo URI", () => {
    const xml = buildWindowsToastXml("A & B", "done", "file:///C:/icon%20a&b.png")

    expect(xml).toContain('src="file:///C:/icon%20a&amp;b.png"')
    expect(xml).toContain("<text>A &amp; B</text>")
  })
})

describe("buildWindowsToastPayload", () => {
  test("carries the app id, display name, icon path and XML for the PowerShell script", () => {
    const payload = buildWindowsToastPayload(
      { title: "OpenCode", message: "done", iconPath: "C:\\icon.png", appID: "opencode", wsl: false }
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
    expect(script).toContain("if ($null -eq $key.GetValue('DisplayName'))")
    expect(script.indexOf("SetValue('DisplayName'")).toBeGreaterThan(script.indexOf("SetValue('IconUri'"))
    expect(script).not.toContain("New-Item")
    expect(script).toContain("Windows.UI.Notifications.ToastNotificationManager")
    expect(script).toContain("CreateToastNotifier($payload.appId).Show($toast)")
  })
})
