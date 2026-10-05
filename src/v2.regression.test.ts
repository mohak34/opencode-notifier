import { afterAll, test, expect } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createV2Notifier } from "./v2"
import type { Delivery } from "./notifier"
import type { OpenCodeEvent, SessionMessageUser } from "@opencode/client"

const fixture = mkdtempSync(join(tmpdir(), "notifier-v2-test-"))
const configPath = join(fixture, "config.json")
const commandLog = join(fixture, "commands.txt")
const commandScript = join(fixture, "record-command.mjs")
writeFileSync(commandScript, 'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], process.argv[3]+"\\n")')
afterAll(() => rmSync(fixture, { recursive: true, force: true }))
let eventID = 0

function event(type: string, data: object): OpenCodeEvent {
  // The fixtures supply only fields the notifier reads; real event types remain checked in v2.ts.
  return { id: `event-${++eventID}`, type, data } as OpenCodeEvent
}

async function exercise(events: OpenCodeEvent[], options: {
  minDuration?: number
  commandMinDuration?: number
  missing?: boolean
  child?: boolean
  delivery?: Delivery
  command?: boolean
  messageAge?: number
  agentName?: string
  sessionLocation?: { directory: string; workspaceID?: string }
} = {}) {
  writeFileSync(configPath, JSON.stringify({
    suppressWhenFocused: false, sound: false, bell: false, notificationSystem: "ghostty",
    minDuration: options.minDuration ?? 0,
    command: { enabled: options.command ?? false, path: process.execPath, args: [commandScript, commandLog, "{event}"], minDuration: options.commandMinDuration ?? 0 },
    events: { session_started: false, client_connected: false, user_message: { notification: true }, complete: { notification: true }, subagent_complete: options.agentName ? { notification: true } : false },
    messages: { user_message: "PROBE_USER {turn}", complete: "PROBE_DONE {turn}", error: "PROBE_ERROR {turn}", question: "PROBE_QUESTION {turn}", subagent_complete: "PROBE_AGENT {agentName} {turn}" },
  }))
  const oldConfig = process.env.OPENCODE_NOTIFIER_CONFIG_PATH
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = configPath
  const originalWrite = process.stdout.write
  const writes: string[] = []
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    writes.push(String(chunk))
    const cb = args.find(x => typeof x === "function") as undefined | (() => void)
    cb?.()
    return true
  }) as typeof process.stdout.write
  const notifier = createV2Notifier({
    session: {
      get: async () => {
        if (options.missing) throw new Error("Session not found")
        return { id: "session", title: "test", location: options.sessionLocation, ...(options.child ? { parentID: "parent", agent: options.agentName } : {}) }
      },
      context: async () => [{ id: "message", type: "user", text: "hello", time: { created: Date.now() - (options.messageAge ?? 1000) } } satisfies SessionMessageUser],
    },
    permission: { list: async () => [] },
  } as never, { directory: fixture }, options.delivery ?? "terminal")
  try {
    for (const input of events) await notifier.event(input)
    return writes.filter(w => w.includes("PROBE_"))
  } finally {
    notifier.dispose()
    process.stdout.write = originalWrite
    if (oldConfig === undefined) delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
    else process.env.OPENCODE_NOTIFIER_CONFIG_PATH = oldConfig
  }
}

test("a user prompt emits once across enqueue, delivery and replay", async () => {
  const enqueued = event("session.inbox.enqueued", { sessionID: "user-session", inboxID: "u1", item: { type: "user", payload: { text: "hi" }, delivery: "queue" } })
  expect((await exercise([enqueued, event("session.inbox.delivered", { sessionID: "user-session", inboxID: "u1" }), enqueued])).length).toBe(1)
})

test("synthetic, compaction and move inbox items are not user messages", async () => {
  const inputs = ["synthetic", "compaction", "move"].flatMap(type => [
    event("session.inbox.enqueued", { sessionID: "s", inboxID: type, item: { type, payload: {} } }),
    event("session.inbox.delivered", { sessionID: "s", inboxID: type }),
  ])
  expect((await exercise(inputs)).length).toBe(0)
})

test("one-second session is suppressed by minDuration=60", async () => {
  expect((await exercise([event("session.execution.succeeded", { sessionID: "duration" })], { minDuration: 60 })).length).toBe(0)
})

test("deleted and unknown children never become top-level completion", async () => {
  expect((await exercise([
    event("session.created", { sessionID: "child", parentID: "parent" }),
    event("session.deleted", { sessionID: "child" }),
    event("session.execution.succeeded", { sessionID: "child" }),
    event("session.execution.succeeded", { sessionID: "unknown" }),
  ], { missing: true })).length).toBe(0)
})

test("v2 execution success produces one completion, even on replay", async () => {
  const finished = event("session.execution.succeeded", { sessionID: "success" })
  expect((await exercise([event("session.execution.started", { sessionID: "success" }), finished, finished])).length).toBe(1)
})

test("a new run clears error suppression", async () => {
  const output = await exercise([
    event("session.execution.failed", { sessionID: "retry", error: {} }),
    event("session.execution.started", { sessionID: "retry" }),
    event("session.execution.succeeded", { sessionID: "retry" }),
  ])
  expect(output.filter(w => w.includes("PROBE_DONE")).length).toBe(1)
  expect(output.filter(w => w.includes("PROBE_ERROR")).length).toBe(1)
})

test("question forms notify once; other forms and plan switches do not", async () => {
  const question = event("form.created", { form: { id: "question", sessionID: "s", metadata: { kind: "question" } } })
  expect((await exercise([
    question, question,
    event("form.created", { form: { id: "other", sessionID: "s" } }),
    event("session.agent.selected", { sessionID: "s", previous: "plan", agent: "build" }),
  ])).length).toBe(1)
})

test("a subagent already running when the plugin loads is excluded from user messages", async () => {
  expect((await exercise([event("session.inbox.enqueued", { sessionID: "child", inboxID: "u1", item: { type: "user" } })], { child: true })).length).toBe(0)
})

test("resolved permissions and non-user interruptions stay silent", async () => {
  expect((await exercise([
    event("permission.asked", { id: "approved", sessionID: "s" }),
    ...["shutdown", "superseded", "inactivity"].map(reason => event("session.execution.interrupted", { sessionID: "s", reason })),
  ])).length).toBe(0)
})

test("events from a different project do not notify", async () => {
  const input = { ...event("session.execution.succeeded", { sessionID: "s" }), location: { directory: "/other-project" } }
  expect((await exercise([input])).length).toBe(0)
})

test("location-less events from another project's session do not notify", async () => {
  const finished = event("session.execution.succeeded", { sessionID: "foreign" })
  expect((await exercise([finished], { sessionLocation: { directory: "/other-project" } })).length).toBe(0)
  expect((await exercise([finished], { sessionLocation: { directory: fixture, workspaceID: "other" } })).length).toBe(0)
})

test("location-less events from this project's session notify", async () => {
  const finished = event("session.execution.succeeded", { sessionID: "own" })
  expect((await exercise([finished], { sessionLocation: { directory: fixture } })).length).toBe(1)
})

test("a failed session lookup fails open", async () => {
  const question = event("form.created", { form: { id: "lookup", sessionID: "gone", metadata: { kind: "question" } } })
  expect((await exercise([question], { missing: true })).length).toBe(1)
})

async function waitForCommands(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(commandLog) && readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).length >= count) return
    await Bun.sleep(10)
  }
  throw new Error("custom command did not finish")
}

test("server owns commands; terminal owns popups; both honor duration", async () => {
  writeFileSync(commandLog, "")
  const completed = event("session.execution.succeeded", { sessionID: "ownership" })
  expect((await exercise([completed], { command: true, delivery: "command" })).length).toBe(0)
  await waitForCommands(1)
  expect((await exercise([completed], { command: true, delivery: "terminal" })).length).toBe(1)
  await exercise([event("session.execution.failed", { sessionID: "quick", error: {} })], { command: true, commandMinDuration: 60, delivery: "command" })
  await Bun.sleep(50)
  expect(readFileSync(commandLog, "utf8")).toBe("complete\n")
})


test("v2 subagent names come from session.agent, not the title", async () => {
  const output = await exercise([event("session.execution.succeeded", { sessionID: "agent" })], { child: true, agentName: "explore" })
  expect(output.length).toBe(1)
  expect(output[0]).toContain("PROBE_AGENT explore")
})

test("another workspace sharing the directory does not notify", async () => {
  const input = { ...event("session.execution.succeeded", { sessionID: "s" }), location: { directory: fixture, workspaceID: "other" } }
  expect((await exercise([input])).length).toBe(0)
})

test("user-message commands preserve their duration-independent behavior", async () => {
  writeFileSync(commandLog, "")
  await exercise([event("session.inbox.enqueued", { sessionID: "s", inboxID: "message", item: { type: "user" } })], { delivery: "command", command: true, commandMinDuration: 60 })
  await waitForCommands(1)
  expect(readFileSync(commandLog, "utf8")).toBe("user_message\n")
})
