import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const testDir = join(tmpdir(), "opencode-notifier-deleted-child-test")
const testConfigPath = join(testDir, "opencode-notifier.json")

// No module mocks: ghostty notifications go to stdout as OSC 9 sequences,
// which we capture. Sound/bell/command stay disabled via config.
let stdoutWrites: string[] = []
const originalStdoutWrite = process.stdout.write.bind(process.stdout)

let sessionGetCalls: string[] = []
let sessionGetImpl: (id: string) => Promise<unknown> = async () => ({
  data: { title: null },
})

const mockClient = {
  session: {
    get: async ({ path }: { path: { id: string } }) => {
      sessionGetCalls.push(path.id)
      return sessionGetImpl(path.id)
    },
    messages: async () => ({ data: [] }),
  },
}

function sessionEvent(type: string, properties: unknown) {
  return { type, properties } as never
}

describe("deleted child sessions (issue #108)", () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      testConfigPath,
      JSON.stringify({
        suppressWhenFocused: false,
        sound: false,
        bell: false,
        notificationSystem: "ghostty",
      })
    )
    process.env.OPENCODE_NOTIFIER_CONFIG_PATH = testConfigPath
    delete process.env.OPENCODE_CLIENT
    stdoutWrites = []
    sessionGetCalls = []
    sessionGetImpl = async () => ({ data: { title: null } })
    process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
      stdoutWrites.push(String(chunk))
      return (args.find((a) => typeof a === "function") as (() => void) | undefined)?.() ?? true
    }) as typeof process.stdout.write
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
    rmSync(testDir, { recursive: true, force: true })
  })

  async function initPlugin() {
    const { NotifierPlugin } = await import("./index")
    const plugin = await NotifierPlugin({ client: mockClient, directory: "/tmp/proj" } as never)
    if (!plugin.event) throw new Error("plugin has no event hook")
    return plugin.event as (input: { event: never }) => Promise<void>
  }

  function finishedNotifications(): string[] {
    return stdoutWrites.filter((w) => w.includes("Session has finished"))
  }

  test("deleted child idle does not fire a top-level complete notification", async () => {
    // The session API is gone for deleted sessions
    sessionGetImpl = async () => {
      throw new Error("session not found")
    }
    const onEvent = await initPlugin()

    await onEvent({
      event: sessionEvent("session.created", { info: { id: "child-1", parentID: "parent-1" } }),
    })
    await onEvent({
      event: sessionEvent("session.deleted", { info: { id: "child-1" } }),
    })
    await onEvent({
      event: sessionEvent("session.idle", { sessionID: "child-1" }),
    })

    expect(finishedNotifications()).toEqual([])
    // Tombstone fast path: no API lookup needed for the known child
    expect(sessionGetCalls).toEqual([])
  })

  test("idle for an unknown session with failing lookup is skipped", async () => {
    sessionGetImpl = async () => {
      throw new Error("session not found")
    }
    const onEvent = await initPlugin()

    await onEvent({
      event: sessionEvent("session.idle", { sessionID: "gone" }),
    })

    expect(finishedNotifications()).toEqual([])
    expect(sessionGetCalls).toEqual(["gone"])
  })

  test("top-level idle still fires complete", async () => {
    sessionGetImpl = async () => ({ data: { title: "work", parentID: null } })
    const onEvent = await initPlugin()

    await onEvent({
      event: sessionEvent("session.idle", { sessionID: "top-1" }),
    })

    expect(finishedNotifications()).toHaveLength(1)
  })
})
