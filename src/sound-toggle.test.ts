import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const testConfigDir = join(homedir(), ".config", "opencode-test-toggle")
const testConfigPath = join(testConfigDir, "opencode-notifier.json")

function setTestEnv() {
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = testConfigPath
}

function unsetTestEnv() {
  delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
}

function createTestConfig(sound: boolean) {
  mkdirSync(testConfigDir, { recursive: true })
  writeFileSync(testConfigPath, JSON.stringify({ sound, notification: true }))
}

function cleanupTestConfig() {
  if (existsSync(testConfigPath)) {
    rmSync(testConfigPath, { force: true })
  }
  if (existsSync(testConfigDir)) {
    rmSync(testConfigDir, { recursive: true, force: true })
  }
}

describe("Sound Toggle", () => {
  beforeEach(() => {
    setTestEnv()
  })

  afterEach(() => {
    unsetTestEnv()
    cleanupTestConfig()
  })

  test("toggleSound switches sound from true to false", async () => {
    createTestConfig(true)
    
    const { toggleSound } = await import("./sound-toggle")
    const result = toggleSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(false)
    expect(result.message).toBe("Sounds have been disabled.")
    
    const config = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(config.sound).toBe(false)
  })

  test("toggleSound switches sound from false to true", async () => {
    createTestConfig(false)
    
    const { toggleSound } = await import("./sound-toggle")
    const result = toggleSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(true)
    expect(result.message).toBe("Sounds have been enabled.")
    
    const config = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(config.sound).toBe(true)
  })

  test("enableSound enables sounds when disabled", async () => {
    createTestConfig(false)
    
    const { enableSound } = await import("./sound-toggle")
    const result = enableSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(true)
    expect(result.message).toBe("Sounds have been enabled.")
    
    const config = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(config.sound).toBe(true)
  })

  test("enableSound keeps sounds enabled when already enabled", async () => {
    createTestConfig(true)
    
    const { enableSound } = await import("./sound-toggle")
    const result = enableSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(true)
    expect(result.message).toBe("Sounds have been enabled.")
  })

  test("disableSound disables sounds when enabled", async () => {
    createTestConfig(true)
    
    const { disableSound } = await import("./sound-toggle")
    const result = disableSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(false)
    expect(result.message).toBe("Sounds have been disabled.")
    
    const config = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(config.sound).toBe(false)
  })

  test("disableSound keeps sounds disabled when already disabled", async () => {
    createTestConfig(false)
    
    const { disableSound } = await import("./sound-toggle")
    const result = disableSound()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(false)
    expect(result.message).toBe("Sounds have been disabled.")
  })

  test("soundStatus returns current status when sounds are enabled", async () => {
    createTestConfig(true)
    
    const { soundStatus } = await import("./sound-toggle")
    const result = soundStatus()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(true)
    expect(result.message).toBe("Sounds are currently enabled.")
  })

  test("soundStatus returns current status when sounds are disabled", async () => {
    createTestConfig(false)
    
    const { soundStatus } = await import("./sound-toggle")
    const result = soundStatus()
    
    expect(result.success).toBe(true)
    expect(result.soundEnabled).toBe(false)
    expect(result.message).toBe("Sounds are currently disabled.")
  })

  test("getSoundStatus returns correct boolean", async () => {
    createTestConfig(true)
    const { getSoundStatus } = await import("./sound-toggle")
    expect(getSoundStatus()).toBe(true)
    
    createTestConfig(false)
    const { getSoundStatus: getSoundStatus2 } = await import("./sound-toggle")
    expect(getSoundStatus2()).toBe(false)
  })

  test("executeSoundToggle handles all actions", async () => {
    const { executeSoundToggle } = await import("./sound-toggle")
    
    createTestConfig(true)
    let result = executeSoundToggle("toggle")
    expect(result.soundEnabled).toBe(false)
    
    result = executeSoundToggle("enable")
    expect(result.soundEnabled).toBe(true)
    
    result = executeSoundToggle("disable")
    expect(result.soundEnabled).toBe(false)
    
    result = executeSoundToggle("status")
    expect(result.soundEnabled).toBe(false)
    expect(result.message).toBe("Sounds are currently disabled.")
  })

  test("returns error when config file does not exist", async () => {
    cleanupTestConfig()
    
    const { toggleSound } = await import("./sound-toggle")
    const result = toggleSound()
    
    expect(result.success).toBe(false)
    expect(result.message).toContain("Config file not found")
  })

  test("executeSoundToggle handles unknown action", async () => {
    const { executeSoundToggle } = await import("./sound-toggle")
    const result = executeSoundToggle("unknown" as any)
    
    expect(result.success).toBe(false)
    expect(result.message).toContain("Unknown action")
  })
})
