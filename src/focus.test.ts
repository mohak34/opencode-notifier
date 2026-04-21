import { describe, test, expect } from "bun:test"
import { isLinuxTerminalFocused, isMacTerminalAppFocused, isTmuxPaneFocused, parseWezTermFocusedPaneId } from "./focus"

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

  test("tmux on macOS falls back to terminal allowlist", () => {
    const env = { TERM_PROGRAM: "tmux", TMUX: "/tmp/tmux-1000/default,1234,0" }
    expect(isMacTerminalAppFocused("Ghostty", env)).toBe(true)
    expect(isMacTerminalAppFocused("Terminal", env)).toBe(true)
  })

  test("tmux fallback still rejects non-terminal frontmost app", () => {
    const env = { TERM_PROGRAM: "tmux", TMUX: "/tmp/tmux-1000/default,1234,0" }
    expect(isMacTerminalAppFocused("Safari", env)).toBe(false)
  })

  test("wezterm TERM_PROGRAM matches WezTerm-GUI frontmost app", () => {
    const env = { TERM_PROGRAM: "wezterm" }
    expect(isMacTerminalAppFocused("WezTerm-GUI", env)).toBe(true)
  })

  test("wezterm TERM_PROGRAM still rejects non-terminal frontmost app", () => {
    const env = { TERM_PROGRAM: "wezterm" }
    expect(isMacTerminalAppFocused("Safari", env)).toBe(false)
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

describe("isLinuxTerminalFocused", () => {
  test("falls back to tmux pane state when window id is unavailable", () => {
    expect(
      isLinuxTerminalFocused({
        cachedWindowId: null,
        currentWindowId: null,
        wezTermPaneActive: true,
        tmuxPaneActive: true,
      })
    ).toBe(true)
  })

  test("does not suppress without tmux when window id is unavailable", () => {
    expect(
      isLinuxTerminalFocused({
        cachedWindowId: null,
        currentWindowId: null,
        wezTermPaneActive: true,
        tmuxPaneActive: null,
      })
    ).toBe(false)
  })

  test("does not suppress when wezterm pane is inactive", () => {
    expect(
      isLinuxTerminalFocused({
        cachedWindowId: null,
        currentWindowId: null,
        wezTermPaneActive: false,
        tmuxPaneActive: true,
      })
    ).toBe(false)
  })

  test("keeps existing window-id check when available", () => {
    expect(
      isLinuxTerminalFocused({
        cachedWindowId: "123",
        currentWindowId: "456",
        wezTermPaneActive: true,
        tmuxPaneActive: true,
      })
    ).toBe(false)
  })
})

describe("parseWezTermFocusedPaneId", () => {
  test("returns pane id from valid list-clients JSON", () => {
    const output = JSON.stringify([
      { focused_pane_id: 18, workspace: "main" },
      { focused_pane_id: 42, workspace: "dev" },
    ])
    expect(parseWezTermFocusedPaneId(output)).toBe("18")
  })

  test("returns null for non-array JSON", () => {
    expect(parseWezTermFocusedPaneId('{"focused_pane_id": 18}')).toBe(null)
  })

  test("returns null for malformed JSON", () => {
    expect(parseWezTermFocusedPaneId("not-json")).toBe(null)
  })

  test("returns null when no focused_pane_id exists", () => {
    const output = JSON.stringify([{ workspace: "main" }, { focused_pane_id: "18" }])
    expect(parseWezTermFocusedPaneId(output)).toBe(null)
  })
})
