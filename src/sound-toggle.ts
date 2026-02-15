import { loadConfig, saveConfig, getConfigPath, type NotifierConfig } from "./config"
import { existsSync } from "fs"

export type SoundToggleAction = "toggle" | "enable" | "disable" | "status"

export interface SoundToggleResult {
  success: boolean
  message: string
  soundEnabled?: boolean
}

function validateConfigExists(): boolean {
  return existsSync(getConfigPath())
}

export function getSoundStatus(): boolean {
  const config = loadConfig()
  return config.sound
}

export function enableSound(): SoundToggleResult {
  if (!validateConfigExists()) {
    return {
      success: false,
      message: "Config file not found. Please run the notifier plugin first to create the default config.",
    }
  }

  const config = loadConfig()
  config.sound = true

  saveConfig(config)

  return {
    success: true,
    message: "Sounds have been enabled.",
    soundEnabled: true,
  }
}

export function disableSound(): SoundToggleResult {
  if (!validateConfigExists()) {
    return {
      success: false,
      message: "Config file not found. Please run the notifier plugin first to create the default config.",
    }
  }

  const config = loadConfig()
  config.sound = false

  saveConfig(config)

  return {
    success: true,
    message: "Sounds have been disabled.",
    soundEnabled: false,
  }
}

export function toggleSound(): SoundToggleResult {
  if (!validateConfigExists()) {
    return {
      success: false,
      message: "Config file not found. Please run the notifier plugin first to create the default config.",
    }
  }

  const config = loadConfig()
  config.sound = !config.sound

  saveConfig(config)

  return {
    success: true,
    message: config.sound ? "Sounds have been enabled." : "Sounds have been disabled.",
    soundEnabled: config.sound,
  }
}

export function soundStatus(): SoundToggleResult {
  if (!validateConfigExists()) {
    return {
      success: false,
      message: "Config file not found. Please run the notifier plugin first to create the default config.",
      soundEnabled: undefined,
    }
  }

  const config = loadConfig()
  const isEnabled = config.sound

  return {
    success: true,
    message: isEnabled ? "Sounds are currently enabled." : "Sounds are currently disabled.",
    soundEnabled: isEnabled,
  }
}

export function executeSoundToggle(action: SoundToggleAction): SoundToggleResult {
  switch (action) {
    case "toggle":
      return toggleSound()
    case "enable":
      return enableSound()
    case "disable":
      return disableSound()
    case "status":
      return soundStatus()
    default:
      return {
        success: false,
        message: `Unknown action: ${action}`,
      }
  }
}
