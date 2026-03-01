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

  test("loadConfig defaults user_cancelled to silent", async () => {
    const { loadConfig, isEventSoundEnabled, isEventNotificationEnabled } = await import("./config")
    const config = loadConfig()

    expect(isEventSoundEnabled(config, "user_cancelled")).toBe(false)
    expect(isEventNotificationEnabled(config, "user_cancelled")).toBe(false)
    expect(config.messages.user_cancelled).toBe("Session was cancelled by user: {sessionTitle}")
  })

  test("loadConfig parses user_cancelled event config from file", async () => {
    const testConfig = {
      events: {
        user_cancelled: { sound: true, notification: true },
      },
      messages: {
        user_cancelled: "Cancelled: {sessionTitle}",
      },
    }
    writeFileSync(testConfigPath, JSON.stringify(testConfig))

    const { loadConfig, isEventSoundEnabled, isEventNotificationEnabled } = await import("./config")
    const config = loadConfig()

    expect(isEventSoundEnabled(config, "user_cancelled")).toBe(true)
    expect(isEventNotificationEnabled(config, "user_cancelled")).toBe(true)
    expect(config.messages.user_cancelled).toBe("Cancelled: {sessionTitle}")
  })

  test("loadConfig keeps user_cancelled silent when global sound/notification are set", async () => {
    const testConfig = {
      sound: true,
      notification: true,
    }
    writeFileSync(testConfigPath, JSON.stringify(testConfig))

    const { loadConfig, isEventSoundEnabled, isEventNotificationEnabled } = await import("./config")
    const config = loadConfig()

    expect(isEventSoundEnabled(config, "user_cancelled")).toBe(false)
    expect(isEventNotificationEnabled(config, "user_cancelled")).toBe(false)
  })

  test("interpolateMessage substitutes {timestamp} placeholder", async () => {
    const { interpolateMessage } = await import("./config")
    const result = interpolateMessage("Event at {timestamp}", { timestamp: "14:30:05" })

    expect(result).toBe("Event at 14:30:05")
  })

  test("interpolateMessage substitutes {turn} placeholder", async () => {
    const { interpolateMessage } = await import("./config")
    const result = interpolateMessage("Question {turn}: {sessionTitle}", { sessionTitle: "Fix bug", turn: 3 })

    expect(result).toBe("Question 3: Fix bug")
  })
  test("interpolateMessage cleans up empty {timestamp} and {turn}", async () => {
    const { interpolateMessage } = await import("./config")
    const result = interpolateMessage("Event {turn} at {timestamp}", {})

    expect(result).toBe("Event at")
  })
})
