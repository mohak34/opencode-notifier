import { describe, test, expect } from "bun:test"
import { execFileSync } from "child_process"
import { buildWindowsFocusScript, decideWindowsFocus, parseWindowsFocusFacts } from "./focus-windows"
import type { WindowsFocusFacts } from "./focus-windows"

const TERMINAL = 100
const OTHER = 200

// Unowned hidden ConPTY window, as under VS Code, WezTerm and Alacritty.
function unowned(ancestors: WindowsFocusFacts["ancestors"], foreground = TERMINAL): WindowsFocusFacts {
  return { foreground, attached: true, consoleWindow: 50, consoleOwner: 50, consoleVisible: false, ancestors }
}

const shell = { pid: 10, name: "pwsh.exe", windows: [] }

describe("decideWindowsFocus", () => {
  const cases: [string, WindowsFocusFacts, boolean][] = [
    ["Windows Terminal window hosting OpenCode in front",
      { foreground: TERMINAL, attached: true, consoleWindow: 50, consoleOwner: TERMINAL, consoleVisible: false, ancestors: [] }, true],
    ["another Windows Terminal window in front",
      { foreground: OTHER, attached: true, consoleWindow: 50, consoleOwner: TERMINAL, consoleVisible: false, ancestors: [] }, false],
    ["classic console window in front",
      { foreground: TERMINAL, attached: true, consoleWindow: TERMINAL, consoleOwner: TERMINAL, consoleVisible: true, ancestors: [] }, true],
    ["another app over the classic console",
      { foreground: OTHER, attached: true, consoleWindow: TERMINAL, consoleOwner: TERMINAL, consoleVisible: true, ancestors: [] }, false],
    ["single-window host in front",
      unowned([shell, { pid: 20, name: "wezterm-gui.exe", windows: [TERMINAL] }]), true],
    ["another app over a single-window host",
      unowned([shell, { pid: 20, name: "wezterm-gui.exe", windows: [TERMINAL] }], OTHER), false],
    ["host with several windows is ambiguous",
      unowned([shell, { pid: 20, name: "Code.exe", windows: [TERMINAL, OTHER] }]), false],
    ["explorer is never the host",
      unowned([shell, { pid: 30, name: "explorer.exe", windows: [TERMINAL] }]), false],
    ["File Explorer in front of a host launched by explorer",
      unowned([shell, { pid: 20, name: "alacritty.exe", windows: [TERMINAL] }, { pid: 30, name: "explorer.exe", windows: [OTHER] }], OTHER), false],
    ["no ancestor owns a window",
      unowned([shell]), false],
    ["no console and no host",
      { foreground: TERMINAL, attached: false, consoleWindow: 0, consoleOwner: 0, consoleVisible: false, ancestors: [] }, false],
    ["no foreground window",
      { foreground: 0, attached: true, consoleWindow: 0, consoleOwner: 0, consoleVisible: false, ancestors: [] }, false],
  ]

  for (const [name, facts, focused] of cases) {
    test(name, () => {
      expect(decideWindowsFocus(facts).focused).toBe(focused)
    })
  }
})

describe("parseWindowsFocusFacts", () => {
  const facts = unowned([{ pid: 20, name: "Code.exe", windows: [TERMINAL] }])

  test("reads the probe JSON around PowerShell noise", () => {
    expect(parseWindowsFocusFacts(`#< CLIXML\r\n${JSON.stringify(facts)}\r\n`)).toEqual(facts)
  })

  test("rejects missing, malformed and mistyped output", () => {
    for (const output of [null, "", "focused", "{", JSON.stringify({ ...facts, foreground: "100" }),
      JSON.stringify({ ...facts, ancestors: [{ pid: 1, name: "a", windows: ["x"] }] })]) {
      expect(parseWindowsFocusFacts(output)).toBe(null)
    }
  })
})

describe("buildWindowsFocusScript", () => {
  test("stops on the first error so no facts are printed", () => {
    const script = buildWindowsFocusScript(4242)
    expect(script.startsWith("$ErrorActionPreference = 'Stop'")).toBe(true)
    expect(script).toContain("::Probe(4242)")
  })

  // Needs real Win32 windows; elsewhere the P/Invoke calls do not exist.
  test.skipIf(process.platform !== "win32")("native probe returns parseable facts", () => {
    const encoded = Buffer.from(buildWindowsFocusScript(process.pid), "utf16le").toString("base64")
    const output = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
      windowsHide: true,
    })
    expect(parseWindowsFocusFacts(output)).not.toBe(null)
  })
})
