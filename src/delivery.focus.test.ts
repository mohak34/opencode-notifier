import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const fixtureRoot = mkdtempSync(join(tmpdir(), "notifier-focus-test-"))
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

// Runs handleEvent in a child process with the terminal reported as focused and every channel stubbed,
// so module mocks never leak into other test files. Returns the channels that delivered.
async function deliveredWhileFocused(suppressWhenFocused: unknown): Promise<string[]> {
  const configPath = join(fixtureRoot, "config.json")
  writeFileSync(configPath, JSON.stringify({
    suppressWhenFocused, bell: true,
    command: { enabled: true, path: "unused" },
  }))
  const module = (name: string) => JSON.stringify(join(import.meta.dir, name))
  const script = `
    const { mock } = await import("bun:test")
    const log = (line) => process.stdout.write(line + "\\n")
    mock.module(${module("focus.ts")}, () => ({
      isTerminalFocused: () => (log("focus-query"), true),
      focusTerminal: async () => {}, isTerminalJumpBackSupported: () => false, debugFocusState: () => {},
    }))
    mock.module(${module("notify.ts")}, () => ({ sendNotification: async () => log("notification") }))
    mock.module(${module("sound.ts")}, () => ({ playSound: async () => log("sound") }))
    mock.module(${module("bell.ts")}, () => ({ ringBell: async () => log("bell") }))
    mock.module(${module("command.ts")}, () => ({ runCommand: () => log("command") }))
    const { loadConfig } = await import(${module("config.ts")})
    const { handleEvent } = await import(${module("delivery.ts")})
    await handleEvent(loadConfig(), "complete", "project")
  `
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...process.env, OPENCODE_NOTIFIER_CONFIG_PATH: configPath },
    stdout: "pipe", stderr: "pipe",
  })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  return (await new Response(child.stdout).text()).trim().split("\n").filter(Boolean).sort()
}

test("suppressWhenFocused true skips every channel while focused", async () => {
  expect(await deliveredWhileFocused(true)).toEqual(["focus-query"])
})

test("suppressWhenFocused false delivers every channel without querying focus", async () => {
  expect(await deliveredWhileFocused(false)).toEqual(["bell", "command", "notification", "sound"])
})

test("suppressWhenFocused list skips only the listed channels", async () => {
  expect(await deliveredWhileFocused(["notification"])).toEqual(["bell", "command", "focus-query", "sound"])
  expect(await deliveredWhileFocused(["notification", "bell", "command"])).toEqual(["focus-query", "sound"])
})

test("an empty suppressWhenFocused list never queries focus", async () => {
  expect(await deliveredWhileFocused([])).toEqual(["bell", "command", "notification", "sound"])
})
