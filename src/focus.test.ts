import { describe, test, expect } from "bun:test"
import { isMacTerminalAppFocused, isTmuxPaneFocused } from "./focus"

describe("isMacTerminalAppFocused", () => {
  test("matches Terminal when TERM_PROGRAM is Apple_Terminal", () => {
    const env = { TERM_PROGRAM: "Apple_Terminal" }
    expect(isMacTerminalAppFocused("Terminal", env)).toBe(true)
  })

  test("matches iTerm2 when TERM_PROGRAM is iTerm.app", () => {
    const env = { TERM_PROGRAM: "iTerm.app" }
    expect(isMacTerminalAppFocused("iTerm2", env)).toBe(true)
  })

  test("matches Ghostty by fallback allowlist", () => {
    const env = {}
    expect(isMacTerminalAppFocused("Ghostty", env)).toBe(true)
  })

  test("returns false for non-terminal app", () => {
    const env = { TERM_PROGRAM: "Apple_Terminal" }
    expect(isMacTerminalAppFocused("Safari", env)).toBe(false)
  })

  test("returns false when frontmost app is unavailable", () => {
    const env = { TERM_PROGRAM: "Apple_Terminal" }
    expect(isMacTerminalAppFocused(null, env)).toBe(false)
  })

  test("regression: no startup cache dependency for later frontmost terminal", () => {
    const env = { TERM_PROGRAM: "Apple_Terminal" }
    expect(isMacTerminalAppFocused("Safari", env)).toBe(false)
    expect(isMacTerminalAppFocused("Terminal", env)).toBe(true)
  })
})

describe("isTmuxPaneFocused", () => {
  test("returns false when TMUX_PANE is missing", () => {
    expect(isTmuxPaneFocused(null, "1 1 1")).toBe(false)
  })

  test("returns false when probe result is unavailable", () => {
    expect(isTmuxPaneFocused("%1", null)).toBe(false)
  })

  test("returns true for active attached pane", () => {
    expect(isTmuxPaneFocused("%1", "1 1 1")).toBe(true)
  })

  test("returns false for inactive pane/window/session", () => {
    expect(isTmuxPaneFocused("%1", "1 1 0")).toBe(false)
    expect(isTmuxPaneFocused("%1", "1 0 1")).toBe(false)
    expect(isTmuxPaneFocused("%1", "0 1 1")).toBe(false)
  })
})
