# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, errors occur, or the question tool is invoked. Works on macOS, Linux, and Windows.

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
  "plugin": ["@mohak34/opencode-notifier@0.1.14"]
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

### If you use a pinned version (e.g., `@0.1.14`)

1. Update the version in your `opencode.json`:

   ```json
   {
     "plugin": ["@mohak34/opencode-notifier@0.1.14"]
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

- **macOS**: No additional setup required. Notifications display the Script Editor icon (custom icons not supported with osascript for reliability)
- **Windows**: No additional setup required. The OpenCode icon displays in notifications
- **Linux**: For sounds, one of these should be installed: `paplay`, `aplay`, `mpv`, or `ffplay`. For notifications, `notify-send` is recommended. The OpenCode icon displays in notifications

**Note**: To disable icons, set `showIcon: false` in your configuration.

### macOS: Choosing Your Notification System

On macOS, you can choose between two notification backends:

- **`osascript`** (default): Most reliable method that always works. Uses AppleScript to display notifications. **Limitation**: Cannot display custom icons (shows Script Editor icon instead).

- **`node-notifier`**: Supports custom icons but some users experience reliability issues where notifications don't appear.

To use `node-notifier` with custom icons:

```json
{
  "notificationSystem": "node-notifier"
}
```

If you experience missing notifications with `node-notifier`, switch back to `osascript` (or remove the option to use the default).

## Configuration

To customize the plugin, create `~/.config/opencode/opencode-notifier.json`:

```json
{
  "sound": true,
  "notification": true,
  "timeout": 5,
  "showProjectName": true,
  "showIcon": true,
  "notificationSystem": "osascript",
  "command": {
    "enabled": false,
    "path": "/path/to/command",
    "args": ["--event", "{event}", "--message", "{message}"],
    "minDuration": 0
  },
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "subagent_complete": { "sound": false, "notification": false },
    "error": { "sound": true, "notification": true },
    "question": { "sound": true, "notification": true }
  },
  "messages": {
    "permission": "Session needs permission",
    "complete": "Session has finished",
    "subagent_complete": "Subagent task completed",
    "error": "Session encountered an error",
    "question": "Session has a question"
  },
  "sounds": {
    "permission": "/path/to/custom/sound.wav",
    "complete": "/path/to/custom/sound.wav",
    "subagent_complete": "/path/to/custom/sound.wav",
    "error": "/path/to/custom/sound.wav",
    "question": "/path/to/custom/sound.wav"
  }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sound` | boolean | `true` | Global toggle for all sounds |
| `notification` | boolean | `true` | Global toggle for all notifications |
| `timeout` | number | `5` | Notification duration in seconds (Linux only) |
| `showProjectName` | boolean | `true` | Show project folder name in notification title |
| `showIcon` | boolean | `true` | Show OpenCode icon in notifications |
| `notificationSystem` | string | `"osascript"` | macOS only: `"osascript"` (reliable, no icons) or `"node-notifier"` (icons, may have issues) |
| `command` | object | — | Command execution settings (enabled/path/args/minDuration) |

### Events

Control sound and notification separately for each event:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": false, "notification": true },
    "subagent_complete": { "sound": true, "notification": false },
    "error": { "sound": true, "notification": false },
    "question": { "sound": true, "notification": true }
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
    "error": true,
    "question": true
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
    "error": "Something went wrong",
    "question": "Input needed"
  }
}
```

### Command

Run a custom command when events fire. Use `{event}` and `{message}` tokens in `path` or `args` to inject the event name and message.

`command.minDuration` (optional, seconds) gates command execution based on the time elapsed since the last user prompt.
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
    "error": "/home/user/sounds/error.wav",
    "question": "/home/user/sounds/question.wav"
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
    "complete": "Session has finished",
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

1. **Check notification permissions:**
   - Open **System Settings > Notifications**
   - Find **Script Editor** in the list
   - Make sure notifications are set to **Banners** or **Alerts**

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
