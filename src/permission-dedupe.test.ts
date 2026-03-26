import { describe, test, expect, beforeEach } from "bun:test"
import { shouldSuppressPermissionAlert, resetPermissionAlertState, prunePermissionAlertState } from "./permission-dedupe"

describe("permission dedupe", () => {
  beforeEach(() => {
    resetPermissionAlertState()
  })

  test("suppresses duplicate events in dedupe window for same session", () => {
    expect(shouldSuppressPermissionAlert("session-a", 1000)).toBe(false)
    expect(shouldSuppressPermissionAlert("session-a", 1500)).toBe(true)
    expect(shouldSuppressPermissionAlert("session-a", 2101)).toBe(false)
  })

  test("suppresses immediate hook fallback when event already fired", () => {
    expect(shouldSuppressPermissionAlert("session-a", 1000)).toBe(false)
    expect(shouldSuppressPermissionAlert(null, 1200)).toBe(true)
  })

  test("pruning clears stale entries", () => {
    expect(shouldSuppressPermissionAlert("session-a", 1000)).toBe(false)
    prunePermissionAlertState(3000)
    expect(shouldSuppressPermissionAlert("session-a", 3001)).toBe(false)
  })
})
