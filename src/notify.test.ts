import { describe, test, expect } from "bun:test"
import { formatGhosttyNotificationSequence } from "./notify"

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
