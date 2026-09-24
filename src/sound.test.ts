import { describe, test, expect, beforeEach } from "bun:test"
import { claimSoundSlot, playSound, resetSoundState } from "./sound"

describe("claimSoundSlot", () => {
  beforeEach(() => {
    resetSoundState()
  })

  test("first sound claims the slot", () => {
    expect(claimSoundSlot("complete", 10000)).toBe(true)
  })

  test("stacked distinct events within the window are coalesced (#52)", () => {
    expect(claimSoundSlot("permission", 10000)).toBe(true)
    expect(claimSoundSlot("complete", 10400)).toBe(false)
    expect(claimSoundSlot("error", 10800)).toBe(false)
  })

  test("repeat of the same event within the window is dropped", () => {
    expect(claimSoundSlot("complete", 10000)).toBe(true)
    expect(claimSoundSlot("complete", 10500)).toBe(false)
  })

  test("sounds after the window play again", () => {
    expect(claimSoundSlot("permission", 10000)).toBe(true)
    expect(claimSoundSlot("complete", 11000)).toBe(true)
  })

  test("event with no sound file does not consume the slot", async () => {
    // plan_exit has no bundled wav; with no custom path nothing can play.
    await playSound("plan_exit", null, 1)
    expect(claimSoundSlot("complete")).toBe(true)
  })
})
