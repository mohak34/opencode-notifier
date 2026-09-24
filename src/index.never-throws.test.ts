import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const testDir = join(tmpdir(), "opencode-notifier-never-throws-test")
const testConfigPath = join(testDir, "opencode-notifier.json")

const originalStdoutWrite = process.stdout.write.bind(process.stdout)

const mockClient = {
  session: {
    get: async () => ({ data: { title: null } }),
    messages: async () => ({ data: [] }),
  },
}

describe("plugin never throws (issue #25)", () => {
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
    process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
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
    return plugin as {
      event: (input: { event: never }) => Promise<void>
      "permission.ask": () => Promise<void>
      "tool.execute.before": (input: never) => Promise<void>
    }
  }

  test("malformed session.status without properties does not throw", async () => {
    const { event: onEvent } = await initPlugin()
    await onEvent({ event: { type: "session.status" } as never })
    await onEvent({ event: { type: "session.status", properties: {} } as never })
  })

  test("malformed session.error without properties does not throw", async () => {
    const { event: onEvent } = await initPlugin()
    await onEvent({ event: { type: "session.error" } as never })
    await onEvent({ event: { type: "session.error", properties: {} } as never })
  })

  test("adjacent hooks with malformed input do not throw", async () => {
    const plugin = await initPlugin()
    await plugin["permission.ask"]()
    await plugin["tool.execute.before"](undefined as never)
    await plugin["tool.execute.before"]({} as never)
  })

  test("runCommand with a missing binary does not throw", async () => {
    const { runCommand } = await import("./command")
    const config = {
      command: {
        enabled: true,
        path: "/nonexistent-dir-xyz/opencode-notifier-test-binary",
        args: ["{event}"],
      },
    } as never
    runCommand(config, "complete", "done")
    // Let the async spawn error surface; the error handler must swallow it.
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})
