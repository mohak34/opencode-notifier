import { expect, test } from "bun:test"
import { join } from "path"

const fixture = join(import.meta.dir, "../test/fixtures/notification-daemon.ts")
const notify = join(import.meta.dir, "notify.ts")
async function run(script: string) {
  const child = Bun.spawn(["dbus-run-session", "--", process.execPath, "--eval", script], {
    stdout: "pipe", stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  return output.trim()
}

test.skipIf(process.platform !== "linux")("a hovered popup keeps its sender and action after the requested timeout", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let clicks = 0
    const started = Date.now()
    await channel.sendNotification("fixture", "hovered popup", 1, undefined, "osascript", false, () => clicks++)
    console.log("delivered", Date.now() - started < 1000)
    await Bun.sleep(2300)
    const [id, popup] = [...daemon.visible.entries()].at(-1)
    console.log("action", popup.actions.includes("focus-terminal"))
    daemon.notifications.ActionInvoked(id, "focus-terminal")
    await Bun.sleep(100)
    console.log("clicks", clicks)
    daemon.notifications.CloseNotification(id)
    await Bun.sleep(100)
    channel.disposeLinuxNotifications?.()
    daemon.stopDaemon()
  `)
  expect(output).toBe("delivered true\naction true\nclicks 1")
}, 10000)
