import { platform } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import { spawn } from "child_process"
import type { EventType } from "./config"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEBOUNCE_MS = 1000
const FULL_VOLUME_PERCENT = 100
const FULL_VOLUME_PULSE = 65536

const lastSoundTime: Record<string, number> = {}
let lastAnySoundTime = 0

// One sound per second max, across all events. The per-event check alone
// lets stacked distinct events (permission + complete) play back-to-back
// pings for a single moment needing attention (#52).
export function claimSoundSlot(event: EventType, now: number = Date.now()): boolean {
  if (now - lastAnySoundTime < DEBOUNCE_MS) {
    return false
  }
  if (lastSoundTime[event] && now - lastSoundTime[event] < DEBOUNCE_MS) {
    return false
  }
  lastAnySoundTime = now
  lastSoundTime[event] = now
  return true
}

export function resetSoundState(): void {
  for (const key of Object.keys(lastSoundTime)) {
    delete lastSoundTime[key]
  }
  lastAnySoundTime = 0
}

function getBundledSoundPath(event: EventType): string {
  const soundFilename = `${event}.wav`

  const possiblePaths = [
    join(__dirname, "..", "sounds", soundFilename),
    join(__dirname, "sounds", soundFilename),
  ]

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return join(__dirname, "..", "sounds", soundFilename)
}

function getSoundFilePath(event: EventType, customPath: string | null): string | null {
  if (customPath && existsSync(customPath)) {
    return customPath
  }

  const bundledPath = getBundledSoundPath(event)
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  return null
}

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "ignore",
      detached: false,
      windowsHide: true,
    })

    proc.on("error", (err) => {
      reject(err)
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}`))
      }
    })
  })
}

function normalizeVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return 1
  }

  if (volume < 0) {
    return 0
  }

  if (volume > 1) {
    return 1
  }

  return volume
}

function toPercentVolume(volume: number): number {
  return Math.round(volume * FULL_VOLUME_PERCENT)
}

function toPulseVolume(volume: number): number {
  return Math.round(volume * FULL_VOLUME_PULSE)
}

async function playOnLinux(soundPath: string, volume: number): Promise<void> {
  const percentVolume = toPercentVolume(volume)
  const pulseVolume = toPulseVolume(volume)
  const players = [
    { command: "paplay", args: [`--volume=${pulseVolume}`, soundPath] },
    { command: "aplay", args: [soundPath] },
    {
      command: "mpv",
      args: [
        "--no-video",
        "--no-terminal",
        "--script-opts=autoload-disabled=yes",
        "--keep-open=no",
        "--idle=no",
        `--volume=${percentVolume}`,
        soundPath,
      ],
    },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", `${percentVolume}`, soundPath] },
  ]

  for (const player of players) {
    try {
      await runCommand(player.command, player.args)
      return
    } catch {
      continue
    }
  }
}

async function playOnMac(soundPath: string, volume: number): Promise<void> {
  await runCommand("afplay", ["-v", `${volume}`, soundPath])
}

async function playOnWindows(soundPath: string): Promise<void> {
  const script = `(New-Object Media.SoundPlayer '${soundPath.replace(/'/g, "''")}').PlaySync()`
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  await runCommand("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded])
}

export async function playSound(
  event: EventType,
  customPath: string | null,
  volume: number
): Promise<void> {
  // Resolve before claiming: an event with no sound file (no custom path
  // and no bundled wav) must not consume the shared slot (#119 review).
  const soundPath = getSoundFilePath(event, customPath)
  if (!soundPath) {
    return
  }

  if (!claimSoundSlot(event)) {
    return
  }

  const normalizedVolume = normalizeVolume(volume)

  const os = platform()

  try {
    switch (os) {
      case "darwin":
        await playOnMac(soundPath, normalizedVolume)
        break
      case "linux":
        await playOnLinux(soundPath, normalizedVolume)
        break
      case "win32":
        await playOnWindows(soundPath)
        break
      default:
        break
    }
  } catch {
    // Silent fail - notification will still work
  }
}
