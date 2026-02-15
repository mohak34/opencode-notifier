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

There's also `subagent_complete` for when subagents finish, but that's silent by default so you don't get spammed.

## Sound Toggle Tool

You can use the `sound-toggle` tool to enable, disable, or check the status of sounds without editing the config file:

```json
{
  "plugin": ["@mohak34/opencode-notifier@latest"]
}
```

Then in OpenCode, just ask:

- "Use sound-toggle to disable sounds" - Turns sounds off
- "Use sound-toggle to enable sounds" - Turns sounds on  
- "Use sound-toggle to toggle sounds" - Switches between on/off
- "Use sound-toggle to check status" - Shows current sound status

The tool will respond with the current state and modify your `opencode-notifier.json` config file accordingly.

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
    "permission": null,
    "complete": null,
    "subagent_complete": null,
    "error": null,
    "question": null
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
  "showIcon": true,
  "notificationSystem": "osascript"
}
```

- `sound` - Turn sounds on/off (default: true)
- `notification` - Turn notifications on/off (default: true)
- `timeout` - How long notifications show in seconds, Linux only (default: 5)
- `showProjectName` - Show folder name in notification title (default: true)
- `showIcon` - Show OpenCode icon, Windows/Linux only (default: true)
- `notificationSystem` - macOS only: `"osascript"` or `"node-notifier"` (default: "osascript")

### Events

Control each event separately:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "subagent_complete": { "sound": false, "notification": false },
    "error": { "sound": true, "notification": true },
    "question": { "sound": true, "notification": true }
  }
}
```

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
    "permission": "Session needs permission",
    "complete": "Session has finished",
    "subagent_complete": "Subagent task completed",
    "error": "Session encountered an error",
    "question": "Session has a question"
  }
}
```

### Sounds

Use your own sound files:

```json
{
  "sounds": {
    "permission": "/path/to/alert.wav",
    "complete": "/path/to/done.wav",
    "subagent_complete": "/path/to/subagent-done.wav",
    "error": "/path/to/error.wav",
    "question": "/path/to/question.wav"
  }
}
```

Platform notes:
- macOS/Linux: .wav or .mp3 files work
- Windows: Only .wav files work
- If file doesn't exist, falls back to bundled sound

### Custom commands

Run your own script when something happens. Use `{event}` and `{message}` as placeholders:

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
- `args` - Arguments to pass, can use `{event}` and `{message}` tokens
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
