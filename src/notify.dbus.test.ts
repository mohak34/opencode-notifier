import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { delimiter, join } from "path"
import { isNotifySendActionBroken } from "./notify"

const directory = mkdtempSync(join(tmpdir(), "notifier-dbus-test-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

function writeExecutable(name: string, body: string): void {
  const path = join(directory, name)
  writeFileSync(path, `#!${process.execPath}\n${body}`)
  chmodSync(path, 0o755)
}

async function runSendNotification(childEnv: Record<string, string | undefined>, script: string) {
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...process.env, ...childEnv, PATH: `${directory}${delimiter}${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  expect(await child.exited, stderr).toBe(0)
  return stdout.trim()
}

describe("isNotifySendActionBroken", () => {
  test("detects the libnotify non-interactive fallback", () => {
    expect(
      isNotifySendActionBroken(
        "Actions are not supported by this notifications server. Displaying non-interactively.\n",
        1,
        50
      )
    ).toBe(true)
  })

  test("treats a fast nonzero exit as broken", () => {
    expect(isNotifySendActionBroken("", 1, 30)).toBe(true)
  })

  test("ignores healthy and slow failures", () => {
    expect(isNotifySendActionBroken("", 0, 1500)).toBe(false)
    expect(isNotifySendActionBroken("", null, 6000)).toBe(false)
    expect(isNotifySendActionBroken("some other daemon error", 1, 5000)).toBe(false)
  })
})

test.skipIf(process.platform !== "linux")(
  "falls back to raw D-Bus Notify when notify-send rejects --action, routing one click",
  async () => {
    const gdbusLog = join(directory, "gdbus-args.jsonl")
    const label = `Say "hi"`
    writeExecutable(
      "notify-send",
      `console.log("4");\nconsole.error("Actions are not supported by this notifications server. Displaying non-interactively.");\nsetTimeout(() => process.exit(1), 50)\n`
    )
    writeExecutable(
      "gdbus",
      `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(gdbusLog)}, JSON.stringify(process.argv.slice(2)) + "\\n")\nconsole.log("(uint32 9,)")\n`
    )
    writeExecutable(
      "dbus-monitor",
      `setTimeout(() => console.log('signal member=ActionInvoked\\n   uint32 99\\n   string "focus-terminal"'), 50)\n` +
        `setTimeout(() => console.log('signal member=ActionInvoked\\n   uint32 9\\n   string "focus-terminal"\\n   uint32 9\\n   string "focus-terminal"'), 100)\n` +
        `setTimeout(() => process.exit(0), 300)\n`
    )
    const modulePath = join(import.meta.dir, "notify.ts")
    const stdout = await runSendNotification({ DBUS_SESSION_BUS_ADDRESS: "fixture" }, `
      const { sendNotification } = await import(${JSON.stringify(modulePath)})
      let clicks = 0
      await sendNotification("OpenCode", "dbus fallback test", 1, undefined, "osascript", false, () => { clicks++ }, undefined, ${JSON.stringify(label)})
      await Bun.sleep(600)
      console.log(clicks)
    `)
    expect(stdout).toBe("1")
    const calls: string[][] = readFileSync(gdbusLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const notifyCall = calls.find((args) => args.includes("org.freedesktop.Notifications.Notify"))
    expect(notifyCall).toBeDefined()
    // The D-Bus actions array is passed as one argv item; embedded quotes
    // in the label are sanitized so the array literal stays valid.
    expect(notifyCall!.find((arg) => arg.startsWith("[\"focus-terminal\""))).toBe(`["focus-terminal", "Say 'hi'"]`)
  }
)

test.skipIf(process.platform !== "linux")(
  "does not touch D-Bus when notify-send handles the action itself",
  async () => {
    const gdbusLog = join(directory, "gdbus-clean.jsonl")
    writeExecutable(
      "notify-send",
      `console.log("123")\nsetTimeout(() => console.log("focus-terminal"), 50)\nsetTimeout(() => process.exit(0), 150)\n`
    )
    writeExecutable(
      "gdbus",
      `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(gdbusLog)}, "called\\n")\nprocess.exit(1)\n`
    )
    writeExecutable("dbus-monitor", `process.exit(1)\n`)
    const modulePath = join(import.meta.dir, "notify.ts")
    const stdout = await runSendNotification({ DBUS_SESSION_BUS_ADDRESS: "fixture" }, `
      const { sendNotification } = await import(${JSON.stringify(modulePath)})
      let clicks = 0
      await sendNotification("OpenCode", "dbus no-fallback test", 1, undefined, "osascript", false, () => { clicks++ })
      await Bun.sleep(300)
      console.log(clicks)
    `)
    expect(stdout).toBe("1")
    expect(existsSync(gdbusLog)).toBe(false)
  }
)
