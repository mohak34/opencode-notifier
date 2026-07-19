import { describe, test, expect } from "bun:test"
import { isCLIClient } from "./index"

describe("isCLIClient", () => {
  test("treats unset env as CLI (opencode default)", () => {
    expect(isCLIClient(undefined)).toBe(true)
  })

  test("treats empty string as CLI", () => {
    expect(isCLIClient("")).toBe(true)
  })

  test("treats 'cli' as CLI", () => {
    expect(isCLIClient("cli")).toBe(true)
  })

  test("treats 'desktop' as non-CLI", () => {
    expect(isCLIClient("desktop")).toBe(false)
  })

  test("treats 'tui' as non-CLI", () => {
    expect(isCLIClient("tui")).toBe(false)
  })

  test("treats any other non-empty value as non-CLI", () => {
    expect(isCLIClient("vscode")).toBe(false)
    expect(isCLIClient("neovim")).toBe(false)
  })
})
