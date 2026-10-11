import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const fixture = join(import.meta.dir, "../test/fixtures/notification-daemon.ts")
const notify = join(import.meta.dir, "notify.ts")

async function run(script: string) {
  const child = Bun.spawn(["dbus-run-session", "--", process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  expect(await child.exited, stderr).toBe(0)
  return stdout.trim()
}

test.skipIf(process.platform !== "linux")("persistent sender routes one click and retires a replaced callback", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let first = 0, second = 0
    await channel.sendNotification("fixture", "first", 1, undefined, "osascript", true, () => first++)
    await channel.sendNotification("fixture", "second", 1, undefined, "osascript", true, () => { second++; throw Error("callback") })
    const [id] = daemon.visible.keys()
    daemon.notifications.ActionInvoked(id + 1, "focus-terminal")
    daemon.notifications.ActionInvoked(id, "other")
    daemon.notifications.ActionInvoked(id, "focus-terminal")
    daemon.notifications.ActionInvoked(id, "focus-terminal")
    await Bun.sleep(50)
    console.log(first, second, daemon.visible.size, daemon.requests[1].replaces === id)
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("0 1 1 true")
})

test.skipIf(process.platform !== "linux")("ungrouped popups share a persistent sender and keep independent actions", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let first = 0, second = 0
    await Promise.all([
      channel.sendNotification("fixture", "first", 1, undefined, "osascript", false, () => first++),
      channel.sendNotification("fixture", "second", 1, undefined, "osascript", false, () => second++),
    ])
    const [a, b] = daemon.requests
    daemon.notifications.CloseNotification(a.id)
    daemon.notifications.ActionInvoked(a.id, "focus-terminal")
    daemon.notifications.ActionInvoked(b.id, "focus-terminal")
    await Bun.sleep(50)
    console.log(first, second, a.sender === b.sender, a.id !== b.id)
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("0 1 true true")
})

test.skipIf(process.platform !== "linux")("disposal closes the sender and clears actions, then a fresh connection can deliver", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let clicks = 0
    await channel.sendNotification("fixture", "first", 1, undefined, "osascript", false, () => clicks++)
    channel.disposeLinuxNotifications()
    await Bun.sleep(50)
    const old = daemon.requests[0]
    console.log(daemon.visible.get(old.id).actions.length)
    daemon.notifications.ActionInvoked(old.id, "focus-terminal")
    await channel.sendNotification("fixture", "second", 1, undefined, "osascript", false, () => clicks++)
    const fresh = daemon.requests[1]
    daemon.notifications.ActionInvoked(fresh.id, "focus-terminal")
    await Bun.sleep(50)
    console.log(clicks, old.sender !== fresh.sender)
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("0\n1 true")
})


test.skipIf(process.platform !== "linux")("signals arriving before the Notify reply are routed after handler registration", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let clicks = 0
    await channel.sendNotification("fixture", "early", 1, undefined, "osascript", false, () => clicks++)
    await channel.sendNotification("fixture", "closed", 1, undefined, "osascript", false, () => clicks++)
    console.log(clicks)
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("1")
})

test.skipIf(process.platform !== "linux")("daemon restart retires old IDs and callbacks before the next delivery", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    let first = 0, second = 0
    await channel.sendNotification("fixture", "before restart", 1, undefined, "osascript", true, () => first++)
    await daemon.restartDaemon()
    await Bun.sleep(30)
    await channel.sendNotification("fixture", "after restart", 1, undefined, "osascript", true, () => second++)
    const request = daemon.requests.at(-1)
    daemon.notifications.ActionInvoked(request.id, "focus-terminal")
    await Bun.sleep(30)
    console.log(first, second, request.replaces)
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("0 1 0")
})

test.skipIf(process.platform !== "linux")("handler capacity closes the oldest popup before releasing its action", async () => {
  const output = await run(`
    const daemon = await import(${JSON.stringify(fixture)})
    const channel = await import(${JSON.stringify(notify)})
    for (let i = 0; i < 129; i++) {
      await channel.sendNotification("fixture", "popup " + i, 1, undefined, "osascript", false, () => {})
    }
    console.log(daemon.visible.size, daemon.visible.has(daemon.requests[0].id), [...daemon.visible.values()].every(popup => popup.actions.length === 2))
    channel.disposeLinuxNotifications()
    daemon.stopDaemon()
  `)
  expect(output).toBe("128 false true")
})

test.skipIf(process.platform !== "linux" || !Bun.which("node"))("pending delivery completes on Node but its idle sender does not keep the client alive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "notifier-node-runtime-"))
  try {
    const result = await Bun.build({ entrypoints: [notify], target: "node", outdir: directory, naming: "notify.mjs", external: ["dbus-next", "node-notifier"] })
    expect(result.success).toBe(true)
    symlinkSync(join(import.meta.dir, "../node_modules"), join(directory, "node_modules"))
    const output = await run(`
      const daemon = await import(${JSON.stringify(fixture)})
      const script = 'const channel = await import(' + ${JSON.stringify(JSON.stringify(join(directory, "notify.mjs")))} + '); await channel.sendNotification("fixture", "exiting client", 1, undefined, "osascript", false, () => {}); console.log("done")'
      const client = Bun.spawn([${JSON.stringify(Bun.which("node"))}, "--input-type=module", "--eval", script], { stdout: "pipe", stderr: "pipe" })
      const timer = setTimeout(() => client.kill(), 1000)
      const code = await client.exited
      clearTimeout(timer)
      console.log(code, (await new Response(client.stdout).text()).trim())
      daemon.stopDaemon()
    `)
    expect(output).toBe("0 done")
  } finally {
    rmSync(directory, {recursive:true,force:true})
  }
})
