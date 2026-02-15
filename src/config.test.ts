import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const testConfigDir = join(homedir(), ".config", "opencode-test")
const testConfigPath = join(testConfigDir, "opencode-notifier.json")

function setTestEnv() {
  process.env.OPENCODE_NOTIFIER_CONFIG_PATH = testConfigPath
}

function unsetTestEnv() {
  delete process.env.OPENCODE_NOTIFIER_CONFIG_PATH
}

function cleanupTestConfig() {
  if (existsSync(testConfigPath)) {
    rmSync(testConfigPath, { force: true })
  }
  if (existsSync(testConfigDir)) {
    rmSync(testConfigDir, { recursive: true, force: true })
  }
}

describe("Config", () => {
  beforeAll(() => {
    setTestEnv()
    mkdirSync(testConfigDir, { recursive: true })
  })

  afterAll(() => {
    unsetTestEnv()
    cleanupTestConfig()
  })

  beforeEach(() => {
    cleanupTestConfig()
    mkdirSync(testConfigDir, { recursive: true })
  })

  afterEach(() => {
    cleanupTestConfig()
  })

  test("loadConfig returns default config when no config file exists", async () => {
    const { loadConfig } = await import("./config")
    const config = loadConfig()
    
    expect(config.sound).toBe(true)
    expect(config.notification).toBe(true)
    expect(config.timeout).toBe(5)
    expect(config.showProjectName).toBe(true)
    expect(config.showIcon).toBe(true)
    expect(config.notificationSystem).toBe("osascript")
  })

  test("loadConfig parses existing config file", async () => {
    const testConfig = {
      sound: false,
      notification: true,
      timeout: 10,
    }
    writeFileSync(testConfigPath, JSON.stringify(testConfig))
    
    const { loadConfig } = await import("./config")
    const config = loadConfig()
    
    expect(config.sound).toBe(false)
    expect(config.notification).toBe(true)
    expect(config.timeout).toBe(10)
  })

  test("loadConfig handles missing optional fields with defaults", async () => {
    const testConfig = {
      sound: false,
    }
    writeFileSync(testConfigPath, JSON.stringify(testConfig))
    
    const { loadConfig } = await import("./config")
    const config = loadConfig()
    
    expect(config.sound).toBe(false)
    expect(config.notification).toBe(true) // default
    expect(config.timeout).toBe(5) // default
  })

  test("loadConfig handles invalid JSON gracefully", async () => {
    writeFileSync(testConfigPath, "invalid json{")
    
    const { loadConfig } = await import("./config")
    const config = loadConfig()
    
    expect(config.sound).toBe(true) // default
    expect(config.notification).toBe(true) // default
  })

  test("loadConfig parses event-specific config", async () => {
    const testConfig = {
      sound: true,
      events: {
        complete: { sound: false, notification: true },
        error: { sound: true, notification: false },
      },
    }
    writeFileSync(testConfigPath, JSON.stringify(testConfig))
    
    const { loadConfig, isEventSoundEnabled, isEventNotificationEnabled } = await import("./config")
    const config = loadConfig()
    
    expect(isEventSoundEnabled(config, "complete")).toBe(false)
    expect(isEventNotificationEnabled(config, "complete")).toBe(true)
    expect(isEventSoundEnabled(config, "error")).toBe(true)
    expect(isEventNotificationEnabled(config, "error")).toBe(false)
  })

  test("saveConfig writes config to file", async () => {
    const { loadConfig, saveConfig } = await import("./config")
    const config = loadConfig()
    
    config.sound = false
    config.timeout = 15
    saveConfig(config)
    
    expect(existsSync(testConfigPath)).toBe(true)
    
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.sound).toBe(false)
    expect(savedConfig.timeout).toBe(15)
  })
})
