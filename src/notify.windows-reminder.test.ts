import { beforeEach, describe, expect, mock, test } from "bun:test"

interface ExecCall {
  command: string
  args: string[]
  options: { timeout?: number; windowsHide?: boolean }
}

const execCalls: ExecCall[] = []
let execError: Error | null = null

// Stub the PowerShell boundary so the reminder path runs for real without
// spawning a process.
mock.module("child_process", () => ({
  execFile(
    command: string,
    args: string[],
    options: ExecCall["options"],
    callback: (error: Error | null) => void
  ) {
    execCalls.push({ command, args, options })
    callback(execError)
    return { kill() {} }
  },
}))

const { deliverWindowsNotification } = await import("./notify-windows")

const request = {
  title: "OpenCode",
  message: "Session finished",
  iconPath: "C:\\icon.png",
  appID: "opencode",
  wsl: false,
}

function fallback() {
  let count = 0
  return {
    count: () => count,
    deliver: async () => {
      count++
    },
  }
}

beforeEach(() => {
  execCalls.length = 0
  execError = null
})

describe("deliverWindowsNotification", () => {
  test("shows the regular toast without starting PowerShell for the default scenario", async () => {
    const defaultToast = fallback()

    await deliverWindowsNotification("default", request, defaultToast.deliver)

    expect(execCalls).toHaveLength(0)
    expect(defaultToast.count()).toBe(1)
  })

  test("replaces the regular toast once the reminder is shown", async () => {
    const defaultToast = fallback()

    await deliverWindowsNotification("reminder", request, defaultToast.deliver)

    expect(defaultToast.count()).toBe(0)
    expect(execCalls).toHaveLength(1)
    expect(execCalls[0].command).toBe("powershell")
    expect(execCalls[0].args).toContain("-EncodedCommand")
    expect(execCalls[0].options.windowsHide).toBe(true)
    // A broken PowerShell must not delay the fallback toast for long.
    expect(execCalls[0].options.timeout).toBeLessThanOrEqual(2000)
  })

  test("falls back to the regular toast when PowerShell fails", async () => {
    execError = new Error("powershell is unavailable")
    const defaultToast = fallback()

    await deliverWindowsNotification("reminder", request, defaultToast.deliver)

    expect(execCalls).toHaveLength(1)
    expect(defaultToast.count()).toBe(1)
  })

  test("launches powershell.exe under WSL", async () => {
    const defaultToast = fallback()

    await deliverWindowsNotification("reminder", { ...request, wsl: true }, defaultToast.deliver)

    expect(execCalls[0].command).toBe("powershell.exe")
    expect(defaultToast.count()).toBe(0)
  })
})
