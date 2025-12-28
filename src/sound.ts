import { platform } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import { spawn } from "child_process"
import type { EventType } from "./config"

const __dirname = dirname(fileURLToPath(import.meta.url))

function getBundledSoundPath(event: EventType): string {
  return join(__dirname, "sounds", `${event}.wav`)
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
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: "ignore",
      detached: false,
    })

    proc.on("error", () => {
      resolve()
    })

    proc.on("close", () => {
      resolve()
    })
  })
}

async function playOnLinux(soundPath: string): Promise<void> {
  const players = [
    { command: "paplay", args: [soundPath] },
    { command: "aplay", args: [soundPath] },
    { command: "mpv", args: ["--no-video", "--no-terminal", soundPath] },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", soundPath] },
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

async function playOnMac(soundPath: string): Promise<void> {
  await runCommand("afplay", [soundPath])
}

async function playOnWindows(soundPath: string): Promise<void> {
  const escapedPath = soundPath.replace(/'/g, "''")
  const psCommand = `(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()`
  await runCommand("powershell", ["-c", psCommand])
}

export async function playSound(
  event: EventType,
  customPath: string | null
): Promise<void> {
  const soundPath = getSoundFilePath(event, customPath)

  if (!soundPath) {
    return
  }

  const os = platform()

  try {
    switch (os) {
      case "darwin":
        await playOnMac(soundPath)
        break
      case "linux":
        await playOnLinux(soundPath)
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
