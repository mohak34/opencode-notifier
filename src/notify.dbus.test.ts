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

// dbus-monitor output: a header line per message, then indented arguments.
function actionInvoked(id: number, key: string): string {
  return `signal time=1 sender=:1.2 -> destination=:1.3 serial=5 path=/org/freedesktop/Notifications; interface=org.freedesktop.Notifications; member=ActionInvoked\n   uint32 ${id}\n   string "${key}"`
}

test.skipIf(process.platform !== "linux")(
  "falls back to raw D-Bus Notify when notify-send rejects --action, routing one click",
  async () => {
    const gdbusLog = join(directory, "gdbus-args.jsonl")
    writeExecutable(
      "notify-send",
      `console.log("4");\nconsole.error("Actions are not supported by this notifications server. Displaying non-interactively.");\nsetTimeout(() => process.exit(1), 50)\n`
    )
    writeExecutable(
      "gdbus",
      `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(gdbusLog)}, JSON.stringify(process.argv.slice(2)) + "\\n")\nconsole.log("(uint32 4,)")\n`
    )
    // Our id with another action, then another id with our action: neither is a click.
    const signals = [actionInvoked(4, "other"), actionInvoked(99, "focus-terminal"), actionInvoked(4, "focus-terminal"), actionInvoked(4, "focus-terminal")]
    writeExecutable(
      "dbus-monitor",
      `setTimeout(() => console.log(${JSON.stringify(signals.slice(0, 2).join("\n"))}), 50)\n` +
        `setTimeout(() => console.log(${JSON.stringify(signals.slice(2).join("\n"))}), 150)\n` +
        `setTimeout(() => process.exit(0), 300)\n`
    )
    const modulePath = join(import.meta.dir, "notify.ts")
    const stdout = await runSendNotification({ DBUS_SESSION_BUS_ADDRESS: "fixture" }, `
      const { sendNotification } = await import(${JSON.stringify(modulePath)})
      const clicks = []
      await sendNotification("-OpenCode \\\\", "dbus fallback test", 1, undefined, "osascript", false, () => clicks.push(Date.now()), undefined, ${JSON.stringify(`Say "hi"`)})
      const sentAt = Date.now()
      await Bun.sleep(600)
      console.log(clicks.length, clicks.every((at) => at - sentAt >= 120))
    `)
    expect(stdout).toBe("1 true")
    const calls: string[][] = readFileSync(gdbusLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const notifyCall = calls.find((args) => args.includes("org.freedesktop.Notifications.Notify"))
    // Strings are GVariant literals after "--"; replaces_id is the
    // non-interactive popup notify-send already showed.
    expect(notifyCall!.slice(notifyCall!.indexOf("--") + 1)).toEqual([
      `"opencode"`, "4", `""`, `"-OpenCode \\\\"`, `"dbus fallback test"`,
      `["focus-terminal", "Say \\"hi\\""]`, "{}", "1000",
    ])
  }
)

test.skipIf(process.platform !== "linux")(
  "replacing a grouped notification retires the old click listener",
  async () => {
    writeExecutable(
      "notify-send",
      `if (process.argv[2] === "--version") { console.log("notify-send 0.8.3"); process.exit(0) }\n` +
        `console.log("7");\nconsole.error("Actions are not supported by this notifications server. Displaying non-interactively.");\nprocess.exit(1)\n`
    )
    writeExecutable("gdbus", `console.log("(uint32 7,)")\n`)
    writeExecutable(
      "dbus-monitor",
      `setTimeout(() => console.log(${JSON.stringify(actionInvoked(7, "focus-terminal"))}), 400)\nsetTimeout(() => process.exit(0), 600)\n`
    )
    const modulePath = join(import.meta.dir, "notify.ts")
    const stdout = await runSendNotification({ DBUS_SESSION_BUS_ADDRESS: "fixture" }, `
      const { sendNotification } = await import(${JSON.stringify(modulePath)})
      const clicks = { first: 0, second: 0 }
      await sendNotification("OpenCode", "first", 1, undefined, "osascript", true, () => { clicks.first++ })
      await Bun.sleep(100)
      await sendNotification("OpenCode", "second", 1, undefined, "osascript", true, () => { clicks.second++ })
      await Bun.sleep(800)
      console.log(clicks.first, clicks.second)
    `)
    expect(stdout).toBe("0 1")
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
