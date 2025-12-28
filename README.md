# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, or errors occur. Works on macOS, Linux, and Windows.

## Installation

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["opencode-notifier"]
}
```

Restart OpenCode. The plugin will be automatically downloaded and activated.

## Configuration

To customize the plugin, create `~/.config/opencode/opencode-notifier.json`:

```json
{
  "sound": true,
  "notification": true,
  "timeout": 5,
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": true, "notification": true },
    "error": { "sound": true, "notification": true }
  },
  "messages": {
    "permission": "OpenCode needs permission",
    "complete": "OpenCode has finished",
    "error": "OpenCode encountered an error"
  },
  "sounds": {
    "permission": "/path/to/custom/sound.wav",
    "complete": "/path/to/custom/sound.wav",
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

### Events

Control sound and notification separately for each event:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true },
    "complete": { "sound": false, "notification": true },
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
    "error": true
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
    "error": "Something went wrong"
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
    "error": "/home/user/sounds/error.wav"
  }
}
```

If a custom sound file path is provided but the file doesn't exist, the plugin will fall back to the bundled sound.

## License

MIT
