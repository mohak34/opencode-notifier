import { afterAll, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const directory = mkdtempSync(join(tmpdir(), "notifier-kde-test-"))
const activePath = join(directory, "active")
const callsPath = join(directory, "calls")
const windowID = "{47b505c0-e34e-4b21-a243-0ae74fe9a10e}"
const otherID = "{6a2e1acf-895f-476b-9cbe-974698a67235}"
const modulePath = join(import.meta.dir, "focus.ts")
const configPath = join(directory, "silent.json")
writeFileSync(configPath, JSON.stringify({ sound: false, notification: false, events: { client_connected: false }, command: { enabled: false } }))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

writeFileSync(join(directory, "kdotool"), `#!${process.execPath}
import { appendFileSync, readFileSync } from "fs"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n")
if (args[0] === "getactivewindow") console.log(readFileSync(${JSON.stringify(activePath)}, "utf8"))
if (args[0] === "getwindowname") console.log("Obsidian — vault")
if (args[0] === "search" && args.includes("--all") && args.includes("--pid") && args[args.indexOf("--pid") + 1] === process.env.FIXTURE_HOST_PID) console.log(process.env.FIXTURE_HOST_WINDOWS ?? ${JSON.stringify(otherID)})
if (args[0] === "getwindowclassname") console.log(args[1] === ${JSON.stringify(otherID)} ? "code" : "ghostty")
if (args[0] === "windowactivate" && process.env.FIXTURE_ACTIVATION_FAILS) process.exit(1)
`)
chmodSync(join(directory, "kdotool"), 0o755)

async function run(script: string, pinned?: string, vscodeHost = false, options: { hostWindows?: string, activationFails?: boolean, termProgram?: string, active?: string } = {}) {
  writeFileSync(callsPath, "")
  writeFileSync(activePath, options.active ?? windowID)
  const parent = `
    const {spawnSync} = require("child_process")
    process.title = "code"
    const child = spawnSync(${JSON.stringify(process.execPath)}, ["--eval", ${JSON.stringify(script)}], {env:{...process.env,FIXTURE_HOST_PID:String(process.pid),TERM_PROGRAM:"vscode"},encoding:"utf8"})
    process.stdout.write(child.stdout)
    process.stderr.write(child.stderr)
    process.exit(child.status ?? 1)
  `
  const child = Bun.spawn(vscodeHost ? [Bun.which("node")!, "--eval", parent] : [process.execPath, "--eval", script], {
    env: {
      ...process.env, PATH: directory, WAYLAND_DISPLAY: "fixture", KDE_SESSION_VERSION: "6",
      HYPRLAND_INSTANCE_SIGNATURE: undefined, SWAYSOCK: undefined, NIRI_SOCKET: undefined,
      TMUX: undefined, WEZTERM_PANE: undefined, ZELLIJ_SESSION_NAME: undefined, ZELLIJ_PANE_ID: undefined,
      TERM_PROGRAM: options.termProgram, OPENCODE_NOTIFIER_WINDOW_ID: pinned,
      FIXTURE_HOST_WINDOWS: options.hostWindows, FIXTURE_ACTIVATION_FAILS: options.activationFails ? "1" : undefined,
      DBUS_SESSION_BUS_ADDRESS: "fixture",
      OPENCODE_NOTIFIER_CONFIG_PATH: configPath, OPENCODE_CLIENT: "cli",
    }, stdout: "pipe", stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  return { output: output.trim(), calls: readFileSync(callsPath, "utf8").trim().split("\n").map(line => JSON.parse(line)) }
}

test.skipIf(process.platform !== "linux")("KDE UUID identifies an embedded terminal without TERM_PROGRAM or process ancestry", async () => {
  const result = await run(`
    import { writeFileSync } from "fs"
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(process.env.OPENCODE_NOTIFIER_WINDOW_ID ?? "unmodified")
    console.log(focus.isTerminalFocused(), focus.getCachedWindowTitle())
    writeFileSync(${JSON.stringify(activePath)}, ${JSON.stringify(otherID)})
    console.log(focus.isTerminalFocused())
    await focus.focusTerminal()
  `)
  expect(result.output).toBe(`unmodified\ntrue Obsidian — vault\nfalse`)
  expect(result.calls).toContainEqual(["getwindowname", windowID])
  expect(result.calls).toContainEqual(["windowactivate", windowID])
})

test.skipIf(process.platform !== "linux")("an explicit embedded host window is used for suppression and activation", async () => {
  const result = await run(`
    import { writeFileSync } from "fs"
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(focus.isTerminalFocused())
    writeFileSync(${JSON.stringify(activePath)}, ${JSON.stringify(otherID)})
    console.log(focus.isTerminalFocused(), focus.getCachedWindowTitle())
    await focus.focusTerminal()
  `, otherID)
  expect(result.output).toBe("false\ntrue Obsidian — vault")
  expect(result.calls).toContainEqual(["getwindowname", otherID])
  expect(result.calls).toContainEqual(["windowactivate", otherID])
})

test("KDE IDs retain numeric compatibility and reject malformed or executable values", async () => {
  const { isKDEWindowId } = await import("./focus")
  for (const value of [windowID, windowID.toUpperCase(), "12345"]) expect(isKDEWindowId(value)).toBe(true)
  for (const value of ["", "-1", "--help", "{bad-id}", `${windowID}; touch /tmp/marker`, "$(id)", "123 456"]) {
    expect(isKDEWindowId(value)).toBe(false)
  }
})

test.skipIf(process.platform !== "linux")("a background VS Code terminal targets its ancestor window instead of the foreground Ghostty", async () => {
  const result = await run(`
    import {writeFileSync} from "fs"
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(process.env.OPENCODE_NOTIFIER_WINDOW_ID ?? "unmodified")
    console.log(focus.isTerminalFocused())
    writeFileSync(${JSON.stringify(activePath)}, ${JSON.stringify(otherID)})
    console.log(focus.isTerminalFocused())
    await focus.focusTerminal()
  `, undefined, true)
  expect(result.output).toBe("unmodified\nfalse\ntrue")
  expect(result.calls).toContainEqual(["windowactivate", otherID])
  expect(result.calls).not.toContainEqual(["windowactivate", windowID])
})

test.skipIf(process.platform !== "linux")("ambiguous VS Code windows fail open and offer no jump action", async () => {
  const thirdID = "{ef22a78e-edcf-4f8b-bc72-e4ce6b722051}"
  const result = await run(`
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(focus.isTerminalFocused(), focus.isTerminalJumpBackSupported())
    await focus.focusTerminal()
  `, undefined, true, { hostWindows: `${otherID}\n${thirdID}` })
  expect(result.output).toBe("false false")
  expect(result.calls.some(args => args[0] === "windowactivate")).toBe(false)
})

test.skipIf(process.platform !== "linux")("the active VS Code window resolves multiple windows owned by its ancestor", async () => {
  const result = await run(`
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(focus.isTerminalFocused(), focus.isTerminalJumpBackSupported())
    await focus.focusTerminal()
  `, undefined, true, { hostWindows: `${windowID}\n${otherID}`, active: otherID })
  expect(result.output).toBe("true true")
  expect(result.calls).toContainEqual(["windowactivate", otherID])
})

test.skipIf(process.platform !== "linux")("a known host with no window never captures another foreground window of that app", async () => {
  const result = await run(`
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(focus.isTerminalFocused(), focus.isTerminalJumpBackSupported())
    await focus.focusTerminal()
  `, undefined, true, { hostWindows: "", active: otherID })
  expect(result.output).toBe("false false")
  expect(result.calls.some(args => args[0] === "windowactivate")).toBe(false)
})

test.skipIf(process.platform !== "linux")("a failed activation never falls back to an unrelated terminal", async () => {
  const result = await run(`
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    await focus.focusTerminal()
  `, undefined, true, { activationFails: true })
  expect(result.calls.filter(args => args[0] === "windowactivate")).toEqual([["windowactivate", otherID]])
  expect(result.calls.some(args => args[0] === "search" && !args.includes("--pid"))).toBe(false)
})

test.skipIf(process.platform !== "linux")("without ancestry, TERM_PROGRAM rejects a foreground window belonging to another app", async () => {
  const result = await run(`
    const focus = await import(${JSON.stringify(modulePath)})
    await focus.captureStartupWindowId()
    console.log(focus.isTerminalFocused(), focus.isTerminalJumpBackSupported())
    await focus.focusTerminal()
  `, undefined, false, { termProgram: "vscode" })
  expect(result.output).toBe("false false")
  expect(result.calls.some(args => args[0] === "windowactivate")).toBe(false)
})

test.skipIf(process.platform !== "linux")("V1 and V2 terminal setup await host capture before enabling delivery", async () => {
  for (const host of ["index.ts", "tui.ts"]) {
    const result = await run(`
      const {default: plugin} = await import(${JSON.stringify(import.meta.dir)} + "/${host}")
      const dispose = ${host === "index.ts" ? `await plugin.server({client:{},directory:${JSON.stringify(directory)}})` : `await plugin.setup({client:{},location:{directory:${JSON.stringify(directory)}},data:{listen(){return () => {}}}})`}
      const focus = await import(${JSON.stringify(modulePath)})
      console.log(focus.isTerminalFocused(), focus.isTerminalJumpBackSupported())
      await focus.focusTerminal()
      ${host === "index.ts" ? "await dispose.dispose?.()" : "await dispose?.()"}
    `, undefined, true)
    expect(result.output).toBe("false true")
    expect(result.calls).toContainEqual(["windowactivate", otherID])
    expect(result.calls).not.toContainEqual(["windowactivate", windowID])
  }
})
