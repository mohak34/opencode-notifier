import { platform } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import { spawn } from "child_process"
import type { EventType } from "./config"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEBOUNCE_MS = 1000

const lastSoundTime: Record<string, number> = {}

function getBundledSoundPath(event: EventType): string {
  return join(__dirname, "..", "sounds", `${event}.wav`)
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

async function playOnLinux(soundPath: string, volume: number): Promise<void> {
  // Convert 0-1 volume to percentage for different players
  const volumePercent = Math.round(volume * 100)
  
  const players = [
    { command: "paplay", args: [`--volume=${volumePercent * 655}`, soundPath] }, // paplay uses 0-65536
    { command: "aplay", args: [soundPath] }, // aplay doesn't support volume directly
    { command: "mpv", args: ["--no-video", "--no-terminal", `--volume=${volumePercent}`, soundPath] },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", volumePercent.toString(), soundPath] },
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
  await runCommand("afplay", ["-v", volume.toString(), soundPath])
}

async function playOnWindows(soundPath: string): Promise<void> {
  const script = `& { (New-Object Media.SoundPlayer $args[0]).PlaySync() }`
  await runCommand("powershell", ["-c", script, soundPath])
}

export async function playSound(
  event: EventType,
  customPath: string | null,
  volume: number = 1.0
): Promise<void> {
  const now = Date.now()
  if (lastSoundTime[event] && now - lastSoundTime[event] < DEBOUNCE_MS) {
    return
  }
  lastSoundTime[event] = now

  const soundPath = getSoundFilePath(event, customPath)

  if (!soundPath) {
    return
  }

  const os = platform()

  try {
    switch (os) {
      case "darwin":
        await playOnMac(soundPath, volume)
        break
      case "linux":
        await playOnLinux(soundPath, volume)
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
