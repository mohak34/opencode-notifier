# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, or errors occur. Works on macOS, Linux, and Windows.

## Installation

Add the plugin to your `opencode.json` or `opencode.jsonc`:

```json
{
  "plugin": ["@mohak34/opencode-notifier@latest"]
}
```

Using `@latest` ensures you always get the newest version when the cache is refreshed.

To pin a specific version:

```json
{
  "plugin": ["@mohak34/opencode-notifier@0.1.10"]
}
```

Restart OpenCode. The plugin will be automatically installed and loaded.

## Updating

OpenCode caches plugins in `~/.cache/opencode`. Plugins are not auto-updated; you need to clear the cache to get new versions.

### If you use `@latest`

Clear the cache and restart OpenCode:

**Linux/macOS:**

```bash
rm -rf ~/.cache/opencode/node_modules/@mohak34/opencode-notifier
```

**Windows (PowerShell):**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\node_modules\@mohak34\opencode-notifier"
```

Then restart OpenCode - it will download the latest version automatically.

### If you use a pinned version (e.g., `@0.1.10`)

1. Update the version in your `opencode.json`:

   ```json
   {
     "plugin": ["@mohak34/opencode-notifier@0.1.10"]
   }
   ```

2. Clear the cache (see commands above)

3. Restart OpenCode

### Check installed version

**Linux/macOS:**

```bash
cat ~/.cache/opencode/node_modules/@mohak34/opencode-notifier/package.json | grep version
```

**Windows (PowerShell):**

```powershell
Get-Content "$env:USERPROFILE\.cache\opencode\node_modules\@mohak34\opencode-notifier\package.json" | Select-String "version"
```

## Platform Notes

The plugin works out of the box on all platforms. For best results:

- **macOS**: No additional setup required
- **Windows**: No additional setup required
- **Linux**: For sounds, one of these should be installed: `paplay`, `aplay`, `mpv`, or `ffplay`. For notifications, `notify-send` is recommended.

## Configuration

To customize the plugin, create `~/.config/opencode/opencode-notifier.json`:

```json
{
  "sound": true,
  "notification": true,
  "timeout": 5,
  "command": {
    "enabled": false,
    "path": "/path/to/command",
    "args": ["--event", "{event}", "--message", "{message}"]
  },
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "subagent_complete": { "sound": false, "notification": false },
    "error": { "sound": true, "notification": true }
  },
  "messages": {
    "permission": "OpenCode needs permission",
    "complete": "OpenCode has finished",
    "subagent_complete": "Subagent has finished",
    "error": "OpenCode encountered an error"
  },
  "sounds": {
    "permission": "/path/to/custom/sound.wav",
    "complete": "/path/to/custom/sound.wav",
    "subagent_complete": "/path/to/custom/sound.wav",
    "error": "/path/to/custom/sound.wav"
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sound` | boolean | `true` | Global toggle for all sounds |
| `notification` | boolean | `true` | Global toggle for all notifications |
| `timeout` | number | `5` | Notification duration in seconds (Linux only) |
| `command` | object | — | Command execution settings (enabled/path/args) |

### Events

Control sound and notification separately for each event:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": false, "notification": true },
    "subagent_complete": { "sound": true, "notification": false },
    "error": { "sound": true, "notification": false }
  }
}
```

Or use a boolean to toggle both:

```json
{
  "events": {
    "permission": true,
    "complete": false,
    "subagent_complete": true,
    "error": true
  }
}
```

Note: `complete` fires for primary (main) session completion, while `subagent_complete` fires for subagent completion. `subagent_complete` defaults to disabled (both sound and notification are false).

### Messages

Customize notification text:

```json
{
  "messages": {
    "permission": "Action required",
    "complete": "Done!",
    "subagent_complete": "Subagent finished",
    "error": "Something went wrong"
  }
}
```

### Command

Run a custom command when events fire. Use `{event}` and `{message}` tokens in `path` or `args` to inject the event name and message.

`command.minDuration` (optional, seconds) gates command execution based on the elapsed prompt execution time.
- Applies to all events for the custom command.
- If elapsed time is known and is below `minDuration`, the command is skipped.
- If elapsed time cannot be determined for an event, the command still runs.

```json
{
  "command": {
    "enabled": true,
    "path": "/path/to/command",
    "args": ["--event", "{event}", "--message", "{message}"],
    "minDuration": 10
  }
}
```

### Custom Sounds

Use your own sound files:

```json
{
  "sounds": {
    "permission": "/home/user/sounds/alert.wav",
    "complete": "/home/user/sounds/done.wav",
    "subagent_complete": "/home/user/sounds/subagent-done.wav",
    "error": "/home/user/sounds/error.wav"
  }
}
```

If a custom sound file path is provided but the file doesn't exist, the plugin will fall back to the bundled sound.

### Example: Different behaviors for main and subagent completion

You may want different notification behaviors for primary sessions versus subagent sessions. For example:

- **Main session completion**: Play a sound and show a system notification
- **Subagent completion**: Play a different sound, but no system notification

```json
{
  "events": {
    "complete": { "sound": true, "notification": true },
    "subagent_complete": { "sound": true, "notification": false }
  },
  "messages": {
    "complete": "OpenCode has finished",
    "subagent_complete": "Subagent task completed"
  },
  "sounds": {
    "complete": "/home/user/sounds/main-done.wav",
    "subagent_complete": "/home/user/sounds/subagent-chime.wav"
  }
}
```

## Troubleshooting

### macOS: Notifications not showing (only sound works)

**Update to v0.1.10 or later** - this version includes a fix for macOS notification events.

If notifications still don't work after updating:

1. **Install terminal-notifier via Homebrew:**

   ```bash
   brew install terminal-notifier
   ```

2. **Check notification permissions:**
   - Open **System Settings > Notifications**
   - Find your terminal app (e.g., Ghostty, iTerm2, Terminal)
   - Make sure notifications are set to **Banners** or **Alerts**
   - Also enable notifications for **terminal-notifier** if it appears in the list

### Linux: Notifications not showing

1. **Install notify-send:**

   ```bash
   # Debian/Ubuntu
   sudo apt install libnotify-bin

   # Fedora
   sudo dnf install libnotify

   # Arch
   sudo pacman -S libnotify
   ```

2. **Test if it works:**

   ```bash
   notify-send "Test" "Hello"
   ```

### Linux: Sounds not playing

Install one of these audio players: `paplay`, `aplay`, `mpv`, or `ffplay`.

```bash
# Debian/Ubuntu (PulseAudio)
sudo apt install pulseaudio-utils

# Or install mpv
sudo apt install mpv
```

### Windows: Notifications not showing

1. Open **Settings > System > Notifications**
2. Make sure notifications are enabled
3. Check that your terminal app has notification permissions

### General: Plugin not loading

1. **Check your opencode.json syntax:**

   ```json
   {
     "plugin": ["@mohak34/opencode-notifier@latest"]
   }
   ```

2. **Clear the cache and restart:**

   ```bash
   rm -rf ~/.cache/opencode/node_modules/@mohak34/opencode-notifier
   ```

## License

MIT
