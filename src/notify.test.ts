import { describe, test, expect } from "bun:test"
import {
  buildOsascriptNotificationArgs,
  formatGhosttyNotificationSequence,
  parseNotifySendOutputLine,
} from "./notify"

describe("formatGhosttyNotificationSequence", () => {
  test("returns plain OSC 9 outside tmux", () => {
    const sequence = formatGhosttyNotificationSequence("OpenCode", "Task complete", {})
    expect(sequence).toBe("\x1b]9;OpenCode: Task complete\x07")
  })

  test("returns tmux passthrough OSC 9 inside tmux", () => {
    const sequence = formatGhosttyNotificationSequence("OpenCode", "Task complete", { TMUX: "/tmp/tmux-1000/default,123,0" })
    expect(sequence).toBe("\x1bPtmux;\x1b\x1b]9;OpenCode: Task complete\x07\x1b\\")
  })

  test("sanitizes forbidden control characters", () => {
    const sequence = formatGhosttyNotificationSequence("A;B", "C\nD\x07E\x1bF\r", {})
    expect(sequence).toBe("\x1b]9;AB: CDEF\x07")
  })
})

describe("parseNotifySendOutputLine", () => {
  test("parses notification id lines", () => {
    expect(parseNotifySendOutputLine("12345")).toEqual({ type: "id", id: 12345 })
  })

  test("parses focus action key", () => {
    expect(parseNotifySendOutputLine("focus-terminal")).toEqual({ type: "action", action: "focus" })
  })

  test("parses close action", () => {
    expect(parseNotifySendOutputLine("close")).toEqual({ type: "action", action: "close" })
  })

  test("ignores legacy/default tokens and unknown values", () => {
    expect(parseNotifySendOutputLine("default")).toBeNull()
    expect(parseNotifySendOutputLine("0")).toEqual({ type: "id", id: 0 })
    expect(parseNotifySendOutputLine("Focus")).toBeNull()
    expect(parseNotifySendOutputLine("random")).toBeNull()
  })
})

describe("buildOsascriptNotificationArgs", () => {
  test("passes title and message as argv instead of interpolating them into the script", () => {
    const title = "OpenCode (project ' name)"
    const message = "done with $(shell-like text)"

    const args = buildOsascriptNotificationArgs(title, message)

    expect(args[0]).toBe("-e")
    expect(args[1]).toContain("item 1 of argv")
    expect(args[1]).toContain("item 2 of argv")
    expect(args[1]).not.toContain(title)
    expect(args[1]).not.toContain(message)
    expect(args[2]).toBe(message)
    expect(args[3]).toBe(title)
  })
})
