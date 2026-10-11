import { test, expect, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import server from "./index"
import tui from "./tui"
import type { Plugin } from "@opencode/plugin/tui"

const directory = mkdtempSync(join(tmpdir(), "notifier-entrypoint-test-"))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

test("TUI follows location changes and unsubscribes on disposal", async () => {
  const path = join(directory, "config.json")
  writeFileSync(path, JSON.stringify({ suppressWhenFocused: false, sound: false, notificationSystem: "ghostty", events: {client_connected: false}, messages: {complete:"ENTRYPOINT_DONE {turn}"} }))
  const previous = process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = path
  const originalWrite = process.stdout.write
  const writes: string[] = []
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    writes.push(String(chunk))
    const callback = args.find(value => typeof value === "function") as (() => void) | undefined
    callback?.()
    return true
  }) as typeof process.stdout.write
  let location = { directory: "/first-project" }
  let listener: Parameters<Plugin.Context["data"]["listen"]>[0] | undefined
  let stopped = false
  try {
    const dispose = await tui.setup({
      get location() { return location },
      client: { session: { get: async () => ({title:"task"}) } },
      data: { listen(callback: typeof listener) { listener = callback; return () => {stopped = true} } },
    } as never)
    location = { directory: "/second-project" }
    listener?.({ details: { id:`change-${directory}`, type:"session.execution.succeeded", location, data:{sessionID:"session"} } as never })
    for (let attempts = 0; attempts < 50 && !writes.some(value => value.includes("ENTRYPOINT_DONE")); attempts++) await Bun.sleep(5)
    const notifications = writes.filter(value => value.includes("ENTRYPOINT_DONE"))
    expect(notifications.length).toBe(1)
    expect(notifications[0]).toContain("second-project")
    await dispose?.()
    expect(stopped).toBe(true)
    listener?.({ details: { id:"late", type:"session.execution.succeeded", location, data:{sessionID:"session"} } as never })
    await Bun.sleep(10)
    expect(writes.filter(value => value.includes("ENTRYPOINT_DONE")).length).toBe(1)
  } finally {
    process.stdout.write = originalWrite
    if (previous === undefined) delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
    else process.env.OPENCODE_NOTIFIER_CONFIG_PATH = previous
  }
})

test("server subscription errors do not escape and cleanup aborts", async () => {
  const path = join(directory, "silent.json")
  writeFileSync(path, JSON.stringify({sound:false, notification:false, command:{enabled:false}}))
  const previous = process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = path
  let signal: AbortSignal | undefined
  try {
    const dispose = await server.setup({
      location: {directory},
      event: { subscribe(options: {signal: AbortSignal}) {
        signal = options.signal
        return (async function* () { throw new Error("stream closed") })()
      } },
    } as never)
    await dispose?.()
    expect(signal?.aborted).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
    else process.env.OPENCODE_NOTIFIER_CONFIG_PATH = previous
  }
})

test("V1 TUI entrypoint stays inert because its server already handles notifications", async () => {
  expect(await tui.tui()).toBeUndefined()
  expect(typeof server.server).toBe("function")
  expect(typeof server.setup).toBe("function")
})
