# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, errors occur, or the question tool is invoked. Works on macOS, Linux, and Windows.

## Quick Start

Add this to your `opencode.json`:

```json
{
  "plugin": ["@mohak34/opencode-notifier@latest"]
}
```

Restart OpenCode. Done.

## What it does

You'll get notified when:
- OpenCode needs permission to run something
- Your session finishes
- An error happens  
- The question tool pops up

There's also `subagent_complete` for when subagents finish, and `user_cancelled` for when you press ESC to abort -- both are silent by default so you don't get spammed.

## Setup by platform

**macOS**: Nothing to do, works out of the box. Shows the Script Editor icon.

**Linux**: Should work if you already have a notification system setup. If not install libnotify:

```bash
sudo apt install libnotify-bin  # Ubuntu/Debian
sudo dnf install libnotify       # Fedora  
sudo pacman -S libnotify         # Arch
```

For sounds, you need one of: `paplay`, `aplay`, `mpv`, or `ffplay`

**Windows**: Works out of the box. But heads up:
- Only `.wav` files work (not mp3)
- Use full paths like `C:/Users/You/sounds/alert.wav` not `~/`

## Config file

Create `~/.config/opencode/opencode-notifier.json` with the defaults:

```json
{
  "sound": true,
  "notification": true,
  "timeout": 5,
  "showProjectName": true,
  "showSessionTitle": false,
  "showIcon": true,
  "suppressWhenFocused": true,
  "notificationSystem": "osascript",
  "linux": {
    "grouping": false
  },
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
    "question": { "sound": true, "notification": true },
    "user_cancelled": { "sound": false, "notification": false }
  },
  "messages": {
    "permission": "Session needs permission: {sessionTitle}",
    "complete": "Session has finished: {sessionTitle}",
    "subagent_complete": "Subagent task completed: {sessionTitle}",
    "error": "Session encountered an error: {sessionTitle}",
    "question": "Session has a question: {sessionTitle}",
    "user_cancelled": "Session was cancelled by user: {sessionTitle}"
  },
  "sounds": {
    "permission": null,
    "complete": null,
    "subagent_complete": null,
    "error": null,
    "question": null,
    "user_cancelled": null
  },
  "volumes": {
    "permission": 1,
    "complete": 1,
    "subagent_complete": 1,
    "error": 1,
    "question": 1,
    "user_cancelled": 1
  }
}
```

## All options

### Global options

```json
{
  "sound": true,
  "notification": true,
  "timeout": 5,
  "showProjectName": true,
  "showSessionTitle": false,
  "showIcon": true,
  "notificationSystem": "osascript"
}
```

- `sound` - Turn sounds on/off (default: true)
- `notification` - Turn notifications on/off (default: true)
- `timeout` - How long notifications show in seconds, Linux only (default: 5)
- `showProjectName` - Show folder name in notification title (default: true)
- `showSessionTitle` - Include the session title in notification messages via `{sessionTitle}` placeholder (default: true)
- `showIcon` - Show OpenCode icon, Windows/Linux only (default: true)
- `suppressWhenFocused` - Skip notifications and sounds when the terminal is the active window (default: true). See [Focus detection](#focus-detection) for platform details
- `notificationSystem` - macOS only: `"osascript"` or `"node-notifier"` (default: "osascript")
- `linux.grouping` - Linux only: replace notifications in-place instead of stacking (default: false). Requires `notify-send` 0.8+

### Events

Control each event separately:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "subagent_complete": { "sound": false, "notification": false },
    "error": { "sound": true, "notification": true },
    "question": { "sound": true, "notification": true },
    "user_cancelled": { "sound": false, "notification": false }
  }
}
```

`user_cancelled` fires when you press ESC to abort a session. It's silent by default so intentional cancellations don't trigger error alerts. Set `sound` or `notification` to `true` if you want confirmation when cancelling.

Or use true/false for both:

```json
{
  "events": {
    "complete": false
  }
}
```

### Messages

Customize the notification text:

```json
{
  "messages": {
    "permission": "Session needs permission: {sessionTitle}",
    "complete": "Session has finished: {sessionTitle}",
    "subagent_complete": "Subagent task completed: {sessionTitle}",
    "error": "Session encountered an error: {sessionTitle}",
    "question": "Session has a question: {sessionTitle}",
    "user_cancelled": "Session was cancelled by user: {sessionTitle}"
  }
}
```

Messages support placeholder tokens that get replaced with actual values:

- `{sessionTitle}` - The title/summary of the current session (e.g. "Fix login bug")
- `{projectName}` - The project folder name
- `{timestamp}` - Current time in `HH:MM:SS` format (e.g. "14:30:05")
- `{turn}` - Notification counter for the session, increments with each notification (e.g. 1, 2, 3)

When `showSessionTitle` is `false`, `{sessionTitle}` is replaced with an empty string. Any trailing separators (`: `, ` - `, ` | `) are automatically cleaned up when a placeholder resolves to empty.

To disable session titles in messages without changing `showSessionTitle`, just remove the `{sessionTitle}` placeholder from your custom messages.

The `{timestamp}` and `{turn}` placeholders also work in custom command args.

### Sounds

Use your own sound files:

```json
{
  "sounds": {
    "permission": "/path/to/alert.wav",
    "complete": "/path/to/done.wav",
    "subagent_complete": "/path/to/subagent-done.wav",
    "error": "/path/to/error.wav",
    "question": "/path/to/question.wav",
    "user_cancelled": "/path/to/cancelled.wav"
  }
}
```

Platform notes:
- macOS/Linux: .wav or .mp3 files work
- Windows: Only .wav files work
- If file doesn't exist, falls back to bundled sound

### Volumes

Set per-event volume from `0` to `1`:

```json
{
  "volumes": {
    "permission": 0.6,
    "complete": 0.3,
    "subagent_complete": 0.15,
    "error": 1,
    "question": 0.7,
    "user_cancelled": 0.5
  }
}
```

- `0` = mute, `1` = full volume
- Values outside `0..1` are clamped automatically
- On Windows, playback still works but custom volume may not be honored by the default player

### Custom commands

Run your own script when something happens. Use `{event}`, `{message}`, and `{sessionTitle}` as placeholders:

```json
{
  "command": {
    "enabled": true,
    "path": "/path/to/your/script",
    "args": ["{event}", "{message}"],
    "minDuration": 10
  }
}
```

- `enabled` - Turn command on/off
- `path` - Path to your script/executable
- `args` - Arguments to pass, can use `{event}`, `{message}`, and `{sessionTitle}` tokens
- `minDuration` - Skip if response was quick, avoids spam (seconds)

#### Example: Log events to a file

```json
{
  "command": {
    "enabled": true,
    "path": "/bin/bash",
    "args": [
      "-c",
      "echo '[{event}] {message}' >> /tmp/opencode.log"
    ]
  }
}
```

## macOS: Pick your notification style

**osascript** (default): Reliable but shows Script Editor icon

```json
{ 
  "notificationSystem": "osascript" 
}
```

**node-notifier**: Shows OpenCode icon but might miss notifications sometimes

```json
{ 
  "notificationSystem": "node-notifier" 
}
```

**NOTE:** If you go with node-notifier and start missing notifications, just switch back or remove the option from the config. Users have reported issues with using node-notifier for receiving only sounds and no notification popups.

## Focus detection

When `suppressWhenFocused` is `true` (the default), notifications and sounds are skipped if the terminal running OpenCode is the active/focused window. The idea is simple: if you're already looking at it, you don't need an alert.

To disable this and always get notified:

```json
{
  "suppressWhenFocused": false
}
```

### Platform support

| Platform | Method | Requirements | Status |
|----------|--------|--------------|--------|
| macOS | AppleScript (`System Events`) | None | Untested |
| Linux X11 | `xdotool` | `xdotool` installed | Untested |
| Linux Wayland (Hyprland) | `hyprctl activewindow` | None | Tested |
| Linux Wayland (Sway) | `swaymsg -t get_tree` | None | Untested |
| Linux Wayland (KDE) | `kdotool` | `kdotool` installed | Untested |
| Linux Wayland (GNOME) | Not supported | - | Falls back to always notifying |
| Linux Wayland (Niri, river, dwl, Cosmic, etc.) | Not supported | - | Falls back to always notifying |
| Windows | `GetForegroundWindow()` via PowerShell | None | Untested |

**Unsupported compositors**: Wayland has no standard protocol for querying the focused window. Each compositor has its own IPC, and GNOME intentionally doesn't expose focus information. Unsupported compositors fall back to always notifying.

**tmux/screen**: When running inside tmux, the tmux server daemonizes and detaches from the terminal's process tree. The plugin handles this by querying the tmux client PID and walking from there. GNU Screen has the same issue but is not currently handled (falls back to always notifying).

**Fail-open design**: If detection fails for any reason (missing tools, unknown compositor, permissions), it falls back to always notifying. It never silently eats your notifications.

If you test on a platform marked "Untested" and it works (or doesn't), please open an issue and let us know.

## Linux: Notification Grouping

By default, each notification appears as a separate entry. During active sessions this can create noise when multiple events fire quickly (e.g. permission + complete + question).

Enable grouping to replace notifications in-place instead of stacking:

```json
{
  "linux": {
    "grouping": true
  }
}
```

With grouping enabled, each new notification replaces the previous one so you only see the latest event. This requires `notify-send` 0.8+ (standard on Ubuntu 22.04+, Debian 12+, Fedora 36+, Arch). On older systems it falls back to the default stacking behavior automatically.

Works with all major notification daemons (GNOME, dunst, mako, swaync, etc.) on both X11 and Wayland.

## Updating

If Opencode does not update the plugin or there is an issue with the cache version:

```bash
# Linux/macOS
rm -rf ~/.cache/opencode/node_modules/@mohak34/opencode-notifier

# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\node_modules\@mohak34\opencode-notifier"
```

Then restart OpenCode.

## Troubleshooting

**macOS: Not seeing notifications?**
Go to System Settings > Notifications > Script Editor, make sure it's set to Banners or Alerts.

**macOS: node-notifier not showing notifications?**
Switch back to osascript. Some users report node-notifier works for sounds but not visual notifications on certain macOS versions.

**Linux: No notifications?**
Install libnotify-bin:
```bash
sudo apt install libnotify-bin  # Debian/Ubuntu
sudo dnf install libnotify       # Fedora
sudo pacman -S libnotify         # Arch
```

Test with: `notify-send "Test" "Hello"`

**Linux: No sounds?**
Install one of: `paplay`, `aplay`, `mpv`, or `ffplay`

**Windows: Custom sounds not working?**
- Must be .wav format (not .mp3)
- Use full Windows paths: `C:/Users/YourName/sounds/alert.wav` (not `~/`)
- Make sure the file actually plays in Windows Media Player
- If using WSL, the path should be accessible from Windows

**Windows WSL notifications not working?**
WSL doesn't have a native notification daemon. Use PowerShell commands instead:

```json
{
  "notification": false,
  "sound": true,
  "command": {
    "enabled": true,
    "path": "powershell.exe",
    "args": [
      "-Command",
      "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('{message}', 5, 'OpenCode - {event}', 0+64)"
    ]
  }
}
```

**Windows: OpenCode crashes when notifications appear?**
This is a known Bun issue on Windows. Disable native notifications and use PowerShell popups:

```json
{
  "notification": false,
  "sound": true,
  "command": {
    "enabled": true,
    "path": "powershell.exe",
    "args": [
      "-Command",
      "$wshell = New-Object -ComObject Wscript.Shell; $wshell.Popup('{message}', 5, 'OpenCode - {event}', 0+64)"
    ]
  }
}
```

**Plugin not loading?**
- Check your opencode.json syntax
- Clear the cache (see Updating section)
- Restart OpenCode

## Changelog

See [CHANGELOG.md](CHANGELOG.md)

## License

MIT
