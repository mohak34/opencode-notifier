# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, or errors occur. Works on macOS, Linux, and Windows.

## Installation

Add the plugin to your `opencode.json` or `opencode.jsonc`:

```json
{
  "plugin": ["@mohak34/opencode-notifier@latest"]
}
```

Restart OpenCode. The plugin will be automatically installed and loaded.

## Updating

OpenCode caches plugins in `~/.cache/opencode`. To update to the latest version:

1. **Clear the plugin from cache:**
      ```rm -rf ~/.cache/opencode/node_modules/@mohak34/opencode-notifier```
2. Restart OpenCode - it will download the latest version.

To check your installed version:
```cat ~/.cache/opencode/node_modules/@mohak34/opencode-notifier/package.json | grep version```

## Platform Notes

The plugin works out of the box on all platforms. For best results:

- **macOS**: No additional setup required
- **Windows**: No additional setup required
- **Linux**: For sounds, one of these should be installed: `paplay`, `aplay`, `mpv`, or `ffplay`. For notifications, `notify-send` is recommended.

## Configuration

To customize the plugin, create `~/.config/opencode/opencode-notifier.json`. The file supports standard JSON and JSON with comments (JSONC).

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

## Debugging

To enable debug logging and see which events are being received:

```bash
export OPENCODE_NOTIFIER_DEBUG=true
opencode
```

This will create `.opencode_notifier_logs.jsonl` in your current directory with detailed logs:
- Plugin initialization with full config
- Every event received
- Each notification/sound triggered with config values

**Example log output**:
```jsonl
{"timestamp":"2026-01-03T19:30:00.000Z","action":"pluginInit","configLoaded":true,"config":{"events":{"permission":{"sound":true,"notification":true},...}}}
{"timestamp":"2026-01-03T19:30:05.000Z","action":"eventReceived","eventType":"session.status",...}
{"timestamp":"2026-01-03T19:30:05.001Z","action":"handleEvent","eventType":"complete","message":"OpenCode has finished","sessionTitle":"My Project",...}
```

**Note**: Logging only occurs when `OPENCODE_NOTIFIER_DEBUG=true`. No log file is created in normal use.

## Technical Notes

### Event System Migration (v0.1.8+)

Version 0.1.8 migrates to OpenCode's new event system:

| Event Type | Old Event (deprecated) | New Event (v0.1.8+) |
|------------|------------------------|---------------------|
| Permission requests | `permission.updated` | `permission.asked` |
| Session completion | `session.idle` | `session.status` (with `type: "idle"`) |
| Errors | `session.error` | `session.error` (unchanged) |

**Why this matters**: The old events (`permission.updated`, `session.idle`) are deprecated in OpenCode core and may not fire reliably. If you're experiencing notification issues, ensure you're using v0.1.8 or later.

**Source verification**: Event structure documented from OpenCode core:
- `permission.asked`: `packages/opencode/src/permission/next.ts`
- `session.status`: `packages/opencode/src/session/status.ts`

## License

MIT
