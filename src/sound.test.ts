import { describe, test, expect, beforeEach } from "bun:test"
import { buildWindowsSoundScript, claimSoundSlot, playSound, resetSoundState } from "./sound"

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

describe("buildWindowsSoundScript", () => {
  test("full volume plays without touching the mixer", () => {
    expect(buildWindowsSoundScript("C:/a'b.wav", 1)).toBe("(New-Object Media.SoundPlayer 'C:/a''b.wav').PlaySync()")
  })

  test("partial volume sets both channels before playing", () => {
    const script = buildWindowsSoundScript("C:/a.wav", 0.5)
    expect(script).toContain(`waveOutSetVolume([IntPtr]::Zero, ${0x80008000})`)
    expect(script.indexOf("waveOutSetVolume([IntPtr]")).toBeLessThan(script.indexOf("PlaySync"))
  })

  test("zero volume mutes", () => {
    expect(buildWindowsSoundScript("C:/a.wav", 0)).toContain("waveOutSetVolume([IntPtr]::Zero, 0)")
  })
})
