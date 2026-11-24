import { describe, expect, test } from "bun:test"
import { join } from "path"

type PowerShell = "shown" | "failed" | "throws"

interface Delivery {
  powershell: { command: string; args: string[]; options: { timeout: number; windowsHide: boolean } }[]
  toasts: Record<string, unknown>[]
}

// Runs sendNotification in a child process as if on WSL or Windows, with PowerShell and SnoreToast stubbed,
// so module mocks never leak into other test files and no real toast is shown.
async function deliver(host: "wsl" | "windows", powershell: PowerShell, scenario?: string): Promise<Delivery> {
  const module = (name: string) => JSON.stringify(join(import.meta.dir, name))
  const script = `
    const { mock } = await import("bun:test")
    const os = { ...await import("os") }
    const childProcess = { ...await import("child_process") }
    const delivery = { powershell: [], toasts: [] }
    mock.module("os", () => ({ ...os, default: { ...os.default, type: () => ${JSON.stringify(host === "wsl" ? "Linux" : "Windows_NT")} } }))
    mock.module("is-wsl", () => ({ default: ${host === "wsl"} }))
    mock.module(${module("snoretoast.ts")}, () => ({ ensureSnoreToastExecutable: () => {} }))
    mock.module("node-notifier", () => ({ default: { WindowsToaster: class {
      notify(options, callback) { delivery.toasts.push(options); callback(null, "timeout") }
    } } }))
    mock.module("child_process", () => ({ ...childProcess, execFile: (command, args, options, callback) => {
      delivery.powershell.push({ command, args, options })
      if (${JSON.stringify(powershell)} === "throws") throw new Error("spawn E2BIG")
      callback(${JSON.stringify(powershell)} === "failed" ? new Error("powershell is unavailable") : null)
    } }))
    const { sendNotification } = await import(${module("notify.ts")})
    await sendNotification("OpenCode", "Session finished", 5, "C:\\\\icon.png", "osascript", false, undefined, "opencode", undefined,
      ...${JSON.stringify(scenario ? [scenario] : [])})
    process.stdout.write(JSON.stringify(delivery))
  `
  const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  return JSON.parse(await new Response(child.stdout).text())
}

const REGULAR_TOAST = { title: "OpenCode", message: "Session finished", timeout: 5, icon: "C:\\icon.png", appName: "opencode" }

describe.each(["wsl", "windows"] as const)("Windows toast on %s", (host) => {
  test("stays the regular toast, without PowerShell, unless reminder is set", async () => {
    for (const scenario of [undefined, "default"]) {
      expect(await deliver(host, "shown", scenario)).toEqual({ powershell: [], toasts: [REGULAR_TOAST] })
    }
  })

  test("a reminder replaces the regular toast", async () => {
    const { powershell, toasts } = await deliver(host, "shown", "reminder")

    expect(toasts).toEqual([])
    expect(powershell).toHaveLength(1)
    expect(powershell[0].command).toBe(host === "wsl" ? "powershell.exe" : "powershell")
    expect(powershell[0].args).toContain("-EncodedCommand")
    expect(powershell[0].options).toEqual({ timeout: 5000, windowsHide: true })
  })

  test.each(["failed", "throws"] as const)("falls back to the regular toast when PowerShell %s", async (outcome) => {
    const { powershell, toasts } = await deliver(host, outcome, "reminder")

    expect(powershell).toHaveLength(1)
    expect(toasts).toEqual([REGULAR_TOAST])
  })
})
