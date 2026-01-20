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
  "showProjectName": true,
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "error": { "sound": true, "notification": true },
    "question": { "sound": true, "notification": true }
  },
  "messages": {
    "permission": "Session needs permission",
    "complete": "Session has finished",
    "error": "Session encountered an error",
    "question": "Session has a question"
  },
  "sounds": {
    "permission": "/path/to/custom/sound.wav",
    "complete": "/path/to/custom/sound.wav",
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

### Events

Control sound and notification separately for each event:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": false, "notification": true },
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
    "error": true,
    "question": true
  }
}
```

### Messages

Customize notification text:

```json
{
  "messages": {
    "permission": "Action required",
    "complete": "Done!",
    "error": "Something went wrong",
    "question": "Input needed"
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
    "error": "/home/user/sounds/error.wav",
    "question": "/home/user/sounds/question.wav"
  }
}
```

If a custom sound file path is provided but the file doesn't exist, the plugin will fall back to the bundled sound.

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
