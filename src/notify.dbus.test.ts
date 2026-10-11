import { afterAll, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const directory = mkdtempSync(join(tmpdir(), "notifier-dbus-failure-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test.skipIf(process.platform !== "linux")("a broken D-Bus connection fails open with a plain popup", async () => {
  const log = join(directory, "notify-args")
  const executable = join(directory, "notify-send")
  writeFileSync(executable, `#!${process.execPath}\nimport { writeFileSync } from "fs"\nwriteFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)))\nconsole.log("1")\n`)
  chmodSync(executable, 0o755)
  const modulePath = join(import.meta.dir, "notify.ts")
  const child = Bun.spawn([process.execPath, "--eval", `
    const { sendNotification, disposeLinuxNotifications } = await import(${JSON.stringify(modulePath)})
    await sendNotification("fixture", "fallback", 1, undefined, "osascript", false, () => { throw Error("no click") })
    disposeLinuxNotifications()
    console.log("done")
  `], {
    env: { ...process.env, PATH: directory, DBUS_SESSION_BUS_ADDRESS: "unix:path=/does-not-exist/notifier-fixture" },
    stdout: "pipe", stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(output.trim()).toBe("done")
  const args = JSON.parse(readFileSync(log, "utf8"))
  expect(args).toContain("fallback")
  expect(args).not.toContain("--action")
})


test.skipIf(process.platform !== "linux")("a hung daemon is bounded and a disposed delivery cannot create a late popup", async () => {
  const log = join(directory, "hung-notify-args")
  const executable = join(directory, "notify-send")
  writeFileSync(executable, `#!${process.execPath}\nimport { appendFileSync } from "fs"\nappendFileSync(${JSON.stringify(log)}, "plain\\n")\nconsole.log("1")\n`)
  chmodSync(executable, 0o755)
  const fixture = join(import.meta.dir, "../test/fixtures/notification-daemon.ts")
  const modulePath = join(import.meta.dir, "notify.ts")
  const child = Bun.spawn(["dbus-run-session", "--", process.execPath, "--eval", `
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(modulePath)})
    const start = Date.now()
    await channel.sendNotification("fixture", "hang", 1, undefined, "osascript", false, () => {})
    console.log(Date.now() - start < 3000)
    await Bun.sleep(1100)
    const sending = channel.sendNotification("fixture", "hang", 1, undefined, "osascript", false, () => {})
    await Bun.sleep(50)
    channel.disposeLinuxNotifications()
    await sending
    daemon.stopDaemon()
  `], {
    env: { ...process.env, PATH: directory + ":" + process.env.PATH }, stdout: "pipe", stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(output.trim()).toBe("true")
  expect(readFileSync(log, "utf8")).toBe("plain\n")
}, 10000)
