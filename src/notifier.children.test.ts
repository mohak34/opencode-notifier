import { afterAll, afterEach, beforeEach, expect, jest, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { CHILDREN_SETTLE_MS, createNotifier } from "./notifier"

const directory = mkdtempSync(join(tmpdir(), "notifier-children-test-"))
const configPath = join(directory, "config.json")
const config = {
  sound: false, bell: false, suppressWhenFocused: false, notificationSystem: "ghostty",
  showSessionTitle: true, deferCompleteUntilChildrenIdle: true,
  events: { session_started: false, client_connected: false, subagent_complete: false, error: false },
  messages: { complete: "PARENT_DONE {sessionTitle} {turn}" },
}
let previousConfig: string | undefined
let previousWrite: typeof process.stdout.write
let writes: string[]
let notifier: ReturnType<typeof createNotifier>

beforeEach(() => {
  previousConfig = process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = configPath
  writeFileSync(configPath, JSON.stringify(config))
  previousWrite = process.stdout.write
  writes = []
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    writes.push(String(chunk))
    const callback = args.find(value => typeof value === "function") as (() => void) | undefined
    callback?.()
    return true
  }) as typeof process.stdout.write
  notifier = createNotifier({
    info: async id => ({ isChild: id.startsWith("child"), title: id }),
    elapsed: async () => null,
    permissionPending: async () => true,
  }, directory)
})
afterEach(() => {
  jest.useRealTimers()
  notifier.dispose()
  process.stdout.write = previousWrite
  if (previousConfig === undefined) delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  else process.env.OPENCODE_NOTIFIER_CONFIG_PATH = previousConfig
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const parentDone = () => writes.filter(value => value.includes("PARENT_DONE parent")).length

// Fires due timers, then lets the async delivery they started finish.
async function advance(ms: number) {
  jest.advanceTimersByTime(ms)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test("parent completion waits for every active child and emits once", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  await notifier.created("child2", "parent", null)
  notifier.busy("child1")
  notifier.busy("child2")
  await notifier.idle("parent")
  expect(writes).toHaveLength(0)
  await notifier.idle("child1")
  expect(writes).toHaveLength(0)
  await notifier.idle("child2")
  await notifier.idle("child2")
  await advance(CHILDREN_SETTLE_MS - 1)
  expect(parentDone()).toBe(0)
  await advance(1)
  expect(parentDone()).toBe(1)
  await notifier.idle("child2")
  await advance(CHILDREN_SETTLE_MS)
  expect(parentDone()).toBe(1)
})

test("a parent resumed by its children alerts once, after its final turn", async () => {
  jest.useFakeTimers()
  for (const wave of [["child1", "child2"], ["child3"]]) {
    notifier.busy("parent")
    for (const child of wave) await notifier.created(child, "parent", null)
    await notifier.idle("parent")
    for (const child of wave) await notifier.idle(child)
    await advance(CHILDREN_SETTLE_MS / 2)
  }
  notifier.busy("parent")
  await advance(CHILDREN_SETTLE_MS)
  expect(parentDone()).toBe(0)
  await notifier.idle("parent")
  expect(parentDone()).toBe(1)
  await advance(CHILDREN_SETTLE_MS)
  expect(parentDone()).toBe(1)
})

test("a child that starts during grace holds the alert until it stops", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  await notifier.idle("parent")
  await notifier.idle("child1")
  await advance(CHILDREN_SETTLE_MS / 2)
  notifier.busy("child1")
  await advance(CHILDREN_SETTLE_MS / 4)
  await notifier.idle("child1")
  await advance(CHILDREN_SETTLE_MS - 1)
  expect(parentDone()).toBe(0)
  await advance(1)
  expect(parentDone()).toBe(1)
})

test("a new parent run cancels its pending completion", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  notifier.busy("child1")
  await notifier.idle("parent")
  notifier.busy("parent")
  await notifier.idle("child1")
  await advance(CHILDREN_SETTLE_MS)
  expect(writes).toHaveLength(0)
})

test("a parent run during grace cancels that grace", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  await notifier.idle("parent")
  await notifier.idle("child1")
  await advance(CHILDREN_SETTLE_MS / 2)
  notifier.busy("parent")
  await advance(CHILDREN_SETTLE_MS)
  expect(writes).toHaveLength(0)
})

test("existing completion behavior stays unchanged when deferral is disabled", async () => {
  writeFileSync(configPath, JSON.stringify({ ...config, deferCompleteUntilChildrenIdle: false }))
  await notifier.created("child1", "parent", null)
  notifier.busy("child1")
  await notifier.idle("parent")
  expect(writes.filter(value => value.includes("PARENT_DONE parent"))).toHaveLength(1)
})

test("running grandchildren defer completion until they stop", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  await notifier.created("child2", "child1", null)
  await notifier.idle("child1")
  await notifier.idle("parent")
  expect(writes).toHaveLength(0)
  await notifier.stopped("child2")
  await advance(CHILDREN_SETTLE_MS)
  expect(parentDone()).toBe(1)
})

test("a child failure releases the parent completion", async () => {
  jest.useFakeTimers()
  await notifier.created("child1", "parent", null)
  await notifier.idle("parent")
  expect(writes).toHaveLength(0)
  await notifier.failed("child1", "error")
  await advance(CHILDREN_SETTLE_MS)
  expect(parentDone()).toBe(1)
})

test("expired completion is dropped even if a child later finishes or grace is running", async () => {
  jest.useFakeTimers()
  writeFileSync(configPath, JSON.stringify({ ...config, deferredCompleteTimeout: CHILDREN_SETTLE_MS * 2 }))
  await notifier.created("child1", "parent", null)
  await notifier.idle("parent")
  await advance(CHILDREN_SETTLE_MS * 2 - 1)
  await notifier.idle("child1")
  await advance(1)
  await advance(CHILDREN_SETTLE_MS)
  expect(writes).toHaveLength(0)
})
