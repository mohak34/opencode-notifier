# opencode-notifier

OpenCode plugin that plays sounds and sends system notifications when permission is needed, generation completes, errors occur, or the question tool is invoked. Works on macOS, Linux, and Windows.

## Quick Start

For OpenCode 1, add the package to `opencode.json`:

```json
{
  "plugin": ["@mohak34/opencode-notifier@latest"]
}
```

For OpenCode 2, use `plugins`:

```json
{
  "plugins": ["@mohak34/opencode-notifier@latest"]
}
```

Restart OpenCode. The package contains both implementations; you do not select a version manually. V2 loads the package's terminal component automatically in the interactive CLI.

### OpenCode 2 delivery

Sounds, desktop popups, terminal bells, Ghostty notifications, and focus detection run in the terminal client. Custom commands run once per event on the server, including when no terminal is open. This uses the existing `command` configuration; no external notification service is bundled.

With a remote server, put sound and popup settings on your local computer and custom-command settings on the server. Event-command script paths refer to the server's filesystem. Click-command paths refer to the computer displaying the notification. Focus suppression applies to local alerts, not server commands. Each attached terminal receives alerts for its project.

`opencode run` and Desktop/Web clients do not load this terminal component, so they receive no plugin sound, popup, or bell. Server commands still run. V1 delivery and its `enableOnDesktop` behavior are unchanged.

V2 already includes a notification plugin. To avoid duplicate built-in alerts, add `"-opencode.notifications"` to the existing `plugins` list in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["*", "-opencode.notifications"]
}
```

Keep any other entries in that list, with `"-opencode.notifications"` after matching enable entries such as `"*"` or `"opencode.*"`. A later enable entry can turn the built-in alerts back on. `plan_exit` remains a V1 event; V2 has no equivalent plan-ready signal, so that setting is inactive there. `client_connected` is best-effort: terminal startup for local alerts, server plugin startup for custom commands.

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

**WSL**: Set `customIconPath` to a file on the Windows filesystem to avoid icon-path translation issues. You can copy an icon from this repository's `logos` folder. The path is passed to `snoretoast-*.exe`.

In `opencode-notifier.json` config:

```json
{
  "showIcon": true,
  "customIconPath": "C:\\Users\\YourName\\Documents\\opencode-logo-dark.png"
}
```

- If notifications are not showing up, check out: [missing WSL notification](https://github.com/mikaelbr/node-notifier?tab=readme-ov-file#windows-and-wsl2)

## Config file

Create `~/.config/opencode/opencode-notifier.json` with this example configuration. Omitted settings use their defaults:

```json
{
  "sound": true,
  "notification": true,
  "bell": false,
  "timeout": 5,
  "notificationTitle": null,
  "showProjectName": true,
  "showFullPath": false,
  "showSessionTitle": false,
  "showIcon": true,
  "customIconPath": null,
  "suppressWhenFocused": true,
  "focusOnClick": true,
  "enableOnDesktop": false,
  "notificationSystem": "osascript",
  "suppressGhosttySound": false,
  "linux": {
    "grouping": false
  },
  "minDuration": 0,
  "command": {
    "enabled": false,
    "path": "/path/to/command",
    "args": ["--event", "{event}", "--message", "{message}"],
    "minDuration": 0
  },
  "events": {
    "permission": { "sound": true, "notification": true, "command": true, "bell": false },
    "complete": { "sound": true, "notification": true, "command": true, "bell": false },
    "subagent_complete": { "sound": false, "notification": false, "command": true, "bell": false },
    "error": { "sound": true, "notification": true, "command": true, "bell": false },
    "question": { "sound": true, "notification": true, "command": true, "bell": false },
    "user_cancelled": { "sound": false, "notification": false, "command": true, "bell": false },
    "plan_exit": { "sound": true, "notification": true, "command": true, "bell": false },
    "session_started": { "sound": true, "notification": false, "command": true, "bell": false },
    "user_message": { "sound": true, "notification": false, "command": true, "bell": false },
    "client_connected": { "sound": true, "notification": false, "command": true, "bell": false }
  },
  "messages": {
    "permission": "Session needs permission: {sessionTitle}",
    "complete": "Session has finished: {sessionTitle}",
    "subagent_complete": "Subagent task completed: {sessionTitle}",
    "error": "Session encountered an error: {sessionTitle}",
    "question": "Session has a question: {sessionTitle}",
    "user_cancelled": "Session was cancelled by user: {sessionTitle}",
    "plan_exit": "Plan ready for review: {sessionTitle}",
    "session_started": "Session started: {sessionTitle}",
    "user_message": "User sent a message: {sessionTitle}",
    "client_connected": "OpenCode connected"
  },
  "sounds": {
    "permission": null,
    "complete": null,
    "subagent_complete": null,
    "error": null,
    "question": null,
    "user_cancelled": null,
    "plan_exit": null,
    "session_started": null,
    "user_message": null,
    "client_connected": null
  },
  "volumes": {
    "permission": 1,
    "complete": 1,
    "subagent_complete": 1,
    "error": 1,
    "question": 1,
    "user_cancelled": 1,
    "plan_exit": 1,
    "session_started": 1,
    "user_message": 1,
    "client_connected": 1
  }
}
```

## All options

### Global options

```json
{
  "sound": true,
  "notification": true,
  "bell": false,
  "timeout": 5,
  "notificationTitle": null,
  "showProjectName": true,
  "showFullPath": false,
  "showSessionTitle": false,
  "showIcon": true,
  "suppressWhenFocused": true,
  "enableOnDesktop": false,
  "notificationSystem": "osascript",
  "suppressGhosttySound": false
}
```

- `sound` - Default sound setting, overridden by per-event settings (default: true)
- `notification` - Default popup setting, overridden by per-event settings (default: true)
- `bell` - Emit terminal BEL (`\x07`) on events (default: false). Behavior depends on your terminal/WM settings
- `timeout` - Requested Linux popup duration and macOS `node-notifier` callback wait in seconds (default: 5). Popup expiry depends on the notification backend; AppleScript and Ghostty OSC ignore this setting
- `notificationTitle` - Full popup title template (default: `null`, preserving `OpenCode (my-project)` or `OpenCode` when `showProjectName` is false). For example, `"{projectName}: {sessionTitle}"` replaces the entire title. Supports the same tokens as [Messages](#messages); `{sessionTitle}` requires `showSessionTitle: true`. A nonempty rendered title overrides `showProjectName`; omit `{projectName}` to exclude it. Empty or non-string values, and templates that become empty after interpolation, use the default title
- `showProjectName` - Show folder name in notification title (default: true)
- `showFullPath` - Show full absolute path instead of folder name in notification title and `{projectName}` token (default: false). When true, shows `OpenCode (/home/user/projects/myapp)` instead of `OpenCode (myapp)`
- `showSessionTitle` - Include the session title in notification messages via `{sessionTitle}` placeholder (default: false)
- `showIcon` - Show OpenCode icon with Windows/Linux notifications and macOS `node-notifier` (default: true). AppleScript uses the Script Editor icon
- `customIconPath` - Path to a custom icon for notifications. Useful on WSL where Windows paths are needed (default: null)
- `suppressWhenFocused` - Skip popups, sounds, bells, and V1 event commands when the terminal is focused (default: true). A list such as `["notification"]` skips only those channels: `"sound"`, `"notification"`, `"bell"`, `"command"`. V2 server commands are unaffected. See [Focus detection](#focus-detection) for platform details
- `enableOnDesktop` - V1 only: run the plugin on Desktop and Web clients (default: false). V2 runs commands on the server and local alerts in its terminal component; this flag does not control V2 delivery.
- `notificationSystem` - On macOS, select `"osascript"` or `"node-notifier"` (default: "osascript"). Select `"ghostty"` on any platform running Ghostty for native OSC 9 notifications
- `suppressGhosttySound` - macOS only: when `true` with `notificationSystem: "ghostty"`, skips the plugin's sound to avoid duplicating macOS Notification Center's default sound (default: false)
- `minDuration` - Suppress `complete` and `subagent_complete` notifications when session finishes faster than this many seconds (default: 0). See [Minimum duration threshold](#minimum-duration-threshold)
- `linux.grouping` - Linux only: replace notifications in-place instead of stacking (default: false). Requires `notify-send` 0.8+

### Events

Control each event separately:

```json
{
  "events": {
    "permission": { "sound": true, "notification": true, "command": true, "bell": false },
    "complete": { "sound": true, "notification": true, "command": true, "bell": false },
    "subagent_complete": { "sound": false, "notification": false, "command": true, "bell": false },
    "error": { "sound": true, "notification": true, "command": true, "bell": false },
    "question": { "sound": true, "notification": true, "command": true, "bell": false },
    "user_cancelled": { "sound": false, "notification": false, "command": true, "bell": false },
    "plan_exit": { "sound": true, "notification": true, "command": true, "bell": false },
    "session_started": { "sound": true, "notification": false, "command": true, "bell": false },
    "user_message": { "sound": true, "notification": false, "command": true, "bell": false },
    "client_connected": { "sound": true, "notification": false, "command": true, "bell": false }
  }
}
```

`user_cancelled` fires when you press ESC to abort a session. It's silent by default so intentional cancellations don't trigger error alerts. Set `sound` or `notification` to `true` if you want confirmation when cancelling.

`session_started` fires when a new top-level session is created. `user_message` fires when a user message is submitted in a top-level session. `client_connected` is best-effort. On V1 it fires shortly after plugin initialization. On V2, terminal initialization triggers local alerts and server plugin initialization triggers the custom command; it does not track every client reconnection.

The `command` property controls whether the custom command (see [Custom commands](#custom-commands)) runs for that event. Defaults to `true` for all events. Set it to `false` to suppress the command for specific events without disabling it globally.

`bell` is terminal-driven and may be audible, visual, both, or ignored depending on your terminal setup. Quick check: `printf '\a'`.

Boolean shorthand sets `sound`, `notification`, and `command` together. It preserves the inherited `bell` setting:

```json
{
  "events": {
    "complete": false
  }
}
```

If global bells are enabled, use an explicit object to disable every channel: `"complete": { "sound": false, "notification": false, "command": false, "bell": false }`.

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
    "user_cancelled": "Session was cancelled by user: {sessionTitle}",
    "plan_exit": "Plan ready for review: {sessionTitle}",
    "session_started": "Session started: {sessionTitle}",
    "user_message": "User sent a message: {sessionTitle}",
    "client_connected": "OpenCode connected"
  }
}
```

Messages support placeholder tokens that get replaced with actual values:

- `{sessionTitle}` - The title/summary of the current session (e.g. "Fix login bug")
- `{agentName}` - V2 native child-session agent name, with the `(@name subagent)` title suffix as a fallback. V1 uses the title suffix. Empty when no agent name is available
- `{projectName}` - The project folder name
- `{timestamp}` - Current time in `HH:MM:SS` format (e.g. "14:30:05")
- `{turn}` - Notification counter that persists across restarts in `opencode-notifier-state.json` beside the notifier configuration. V2 terminal and server processes can have separate counters; they are not synchronized across machines

When `showSessionTitle` is `false`, `{sessionTitle}` is replaced with an empty string. Any trailing separators (`: `, `-`, `|`) are automatically cleaned up when a placeholder resolves to empty.

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
    "user_cancelled": "/path/to/cancelled.wav",
    "plan_exit": "/path/to/plan-ready.wav",
    "session_started": "/path/to/session-started.wav",
    "user_message": "/path/to/user-message.wav",
    "client_connected": "/path/to/client-connected.wav"
  }
}
```

Platform notes:

- macOS: .wav or .mp3 files work
- Linux: Format support depends on the player. For MP3, use a capable player such as `mpv` or `ffplay`; `aplay` does not decode MP3
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
    "user_cancelled": 0.5,
    "plan_exit": 0.6,
    "session_started": 0.35,
    "user_message": 0.2,
    "client_connected": 0.45
  }
}
```

- On players that support volume control, `0` = mute and `1` = full volume
- Values outside `0..1` are clamped automatically
- `0` skips playback on every platform. Otherwise Windows playback and Linux `aplay` ignore volume settings. For reliable muting, set `sound` to `false` and remove any per-event `sound: true` overrides, or disable sound for each event

### Custom commands

`command` runs a script when an event occurs. On V2 this runs on the server, even without a terminal attached. Use `{event}`, `{message}`, `{sessionTitle}`, `{sessionID}`, `{agentName}`, `{projectName}`, `{timestamp}`, and `{turn}` as placeholders:

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
- `args` - Arguments to pass, can use `{event}`, `{message}`, `{sessionTitle}`, `{sessionID}`, `{agentName}`, `{projectName}`, `{timestamp}`, and `{turn}` tokens
- `minDuration` - Skip if response was quick, avoids spam (seconds)

`{sessionID}` is the ID of the session that triggered the event (e.g. `ses_0048b8aa...`), so a script can tell concurrent sessions in the same project apart. It is empty for events without a session, such as `client_connected`.

Token values are passed as argv values and are not shell-escaped for use inside
script source. Do not put `{message}`, `{sessionTitle}`, or other dynamic tokens
inside a `sh -c`, `bash -c`, `powershell -Command`, or similar script string.
Use a wrapper script and pass the tokens as separate arguments instead.
Custom commands run with the same user permissions as OpenCode, so only enable
scripts you trust.

#### Run a command when clicking a notification

`onClickCommand` runs locally when you activate a notification, separately from the event-time `command`. It is disabled by default. It accepts `enabled`, `path`, and `args` with the same placeholders. The arguments keep the originating notification's session context, even if you switch sessions before clicking.

```json
{
  "focusOnClick": false,
  "onClickCommand": {
    "enabled": true,
    "path": "/path/to/focus-opencode",
    "args": ["{sessionID}", "{projectName}"]
  }
}
```

On Linux, use the explicit **Run command** action button; popup body clicks are not reliably delivered. The notification daemon must support actions and `notify-send` must support `--action`. The click listener expires after `timeout` plus one second. Windows toasts and macOS `node-notifier` deliver their activation callback; AppleScript and Ghostty OSC notifications do not support this command.

`focusOnClick` defaults to `true` and enables the built-in KDE/GNOME jump-back when available. Set it to `false` for a script-only action. When both are enabled, clicking runs your script and focuses the terminal. On V2, configure click commands in the local terminal's configuration and event commands on the server. `events.<event>.command` controls event commands only; a click command is available for any enabled popup.

#### Example: Log events to a file

```json
{
  "command": {
    "enabled": true,
    "path": "/bin/bash",
    "args": [
      "-c",
      "printf '[%s] %s\\n' \"$1\" \"$2\" >> /tmp/opencode.log",
      "opencode-notifier",
      "{event}",
      "{message}"
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

## Ghostty notifications

If you're using [Ghostty](https://ghostty.org/) terminal, you can use its native notification system via [OSC 9](https://ghostty.org/docs/vt/osc/9) escape sequences:

```json
{
  "notificationSystem": "ghostty"
}
```

This sends notifications directly through the terminal instead of using system notification tools. Works on any platform where Ghostty is running.

**macOS:** Ghostty delivers notifications through macOS Notification Center, which plays its own default sound. This can result in duplicate audio with the plugin's sound effects. Set `suppressGhosttySound` to `true` to skip the plugin's sound:

```json
{
  "notificationSystem": "ghostty",
  "suppressGhosttySound": true
}
```

When a Ghostty popup is enabled on macOS, this setting suppresses both bundled and custom plugin sounds. It does not apply to sound-only events without a popup.

If you're using Ghostty inside tmux, enable passthrough in your tmux config so OSC 9 notifications can pass through:

```tmux
set -g allow-passthrough on
```

Then reload tmux config:

```bash
tmux source-file ~/.tmux.conf
```

## Focus detection

When `suppressWhenFocused` is `true` (the default), popups, sounds, bells, and V1 event commands are skipped when the terminal running OpenCode is focused. Supported terminal and multiplexer pane checks also apply. V2 server event commands run independently of local focus.

To disable this and always get notified:

```json
{
  "suppressWhenFocused": false
}
```

To skip only some channels while focused, list them. This keeps sounds but hides popups:

```json
{
  "suppressWhenFocused": ["notification"]
}
```

Valid entries are `"sound"`, `"notification"`, `"bell"`, and `"command"`. Unknown entries are ignored. An empty list behaves like `false`. `"command"` applies to V1 event commands only.

## Minimum duration threshold

You can suppress `complete` and `subagent_complete` notifications for short-lived sessions. Set `minDuration` to the number of seconds a session must exceed to trigger a done notification:

```json
{
  "minDuration": 10
}
```

With the above, if OpenCode finishes in under 10 seconds, no notification, sound, bell, or command is fired. Default is `0` (no threshold).

This is independent of `command.minDuration`, which only controls whether the custom command runs.

### Completion with child sessions

Set `"deferCompleteUntilChildrenIdle": true` to wait for known child sessions before sending the parent's `complete` notification, sound, bell, or command. The default is `false`.

The plugin tracks native OpenCode child sessions and their descendants from creation and execution events. It sends one parent completion after all tracked child work finishes, fails, is interrupted, or is deleted. A new parent run cancels the pending completion. Work from third-party delegation plugins without native child-session events, or work already running before the notifier loads, cannot be tracked reliably.

`deferredCompleteTimeout` limits the wait in milliseconds, default `900000` (15 minutes). Expired pending alerts are dropped rather than reporting completion while work is still running.

### Platform support

| Platform                                 | Method                                   | Requirements          | Status                         |
| ---------------------------------------- | ---------------------------------------- | --------------------- | ------------------------------ |
| macOS                                    | AppleScript (`System Events`)          | None                  | Untested                       |
| Linux X11                                | `xdotool`                              | `xdotool` installed | Untested                       |
| Linux Wayland (Hyprland)                 | `hyprctl activewindow`; legacy or Lua (0.55+) `dispatch` for click-to-focus | None | Tested (0.56.2, Lua config) |
| Linux Wayland (Niri)                     | `niri msg --json focused-window`       | None                  | Tested                         |
| Linux Wayland (Sway)                     | `swaymsg -t get_tree`                  | None                  | Untested                       |
| Linux Wayland (KDE)                      | `kdotool`                              | `kdotool` installed | Tested                         |
| Linux Wayland (GNOME)                    | Optional Shell bridge, then AT-SPI (`gdbus`) | `gdbus` installed   | AT-SPI tested (Ubuntu 26.04.1 LTS + GNOME Shell 50.1 + Ghostty 1.3.0); Shell bridge needs desktop validation |
| Linux Wayland (river, dwl, Cosmic, etc.) | No window backend; pane fallback when available | -                 | Notifies when focus cannot be determined |
| Windows                                  | Foreground window vs. OpenCode's console owner, via PowerShell | None | Untested |

**GNOME Wayland**: Focus detection first tries the optional Shell extension described under [Jump back to terminal](#linux-jump-back-to-terminal-from-notification), then falls back to the accessibility bus. Without the extension, restricted Shell APIs and XWayland tools such as `xdotool` cannot provide the native Wayland window identity used here. The AT-SPI fallback selects the terminal window with its `ACTIVE` state bit set. Ghostty is matched by its `/com/mitchellh/ghostty` AT-SPI path, other terminals by app name, including the `gnome-terminal-server` alias. AT-SPI window identity is `bus@path` since paths repeat across processes. This fallback was verified on Ubuntu 26.04.1 LTS + GNOME Shell 50.1 + Ghostty 1.3.0; the new Shell bridge still needs live desktop validation. With several terminal windows open, suppression compares against the window that was active at startup. Set `OPENCODE_NOTIFIER_DEBUG=1` to log the focus backend decision.

**Windows**: Alerts are suppressed only when the window hosting OpenCode is provably in front. Windows Terminal and the classic console are matched by window handle, so another terminal window or any other app does not suppress alerts. For hosts that do not own their console window, such as VS Code, WezTerm, and Alacritty, the host is the nearest parent process with a visible window. It counts only when it has exactly one such window and is not Explorer, so VS Code with several windows open always alerts. Anything uncertain delivers the alert. Tabs are not distinguished: with OpenCode in a background Windows Terminal tab, the window still counts as focused. Set `OPENCODE_NOTIFIER_DEBUG=1` to log each decision with the raw probe output.

**Unsupported compositors**: Wayland has no standard protocol for querying the focused window. Each compositor has its own IPC. Without a window backend, supported pane checks provide a best-effort fallback. If neither can determine focus, notifications are allowed.

**tmux/screen**: When running inside tmux, focus detection uses tmux pane state (`session_attached`, `window_active`, `pane_active`) via `tmux display-message`. This keeps suppression accurate when switching panes/windows/sessions. On Linux setups where window focus cannot be detected at all, tmux pane state is also used as a best-effort fallback. GNU Screen has no pane detection, but ordinary terminal-window focus detection can still suppress notifications.

**WezTerm panes**: When running in WezTerm with `WEZTERM_PANE` set, focus suppression is pane-aware via `wezterm cli list-clients --format json`. This means notifications are shown when you switch to a different WezTerm pane/tab.

**Zellij panes**: With `ZELLIJ_SESSION_NAME` and `ZELLIJ_PANE_ID` set, suppression also checks `zellij --session <name> action list-clients`. Switching away from the OpenCode pane or tab allows notifications even when the terminal window stays focused. With multiple clients, the pane counts as focused if any attached client focuses it. A missing tool, failed query, or detached session allows notifications. On Linux without window detection, pane focus is a best-effort fallback, as with tmux.

**Fail-open design**: If window and supported pane checks cannot determine focus, focus suppression allows notifications. Other settings such as event disabling and minimum duration still apply.

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

## Linux: Jump back to terminal from notification

On KDE Plasma and GNOME Wayland, use the explicit **Jump to terminal** action button. Clicking the popup body is not reliably routed back to the plugin.

On KDE with `kdotool` installed, the plugin captures the startup terminal window ID and jumps back to that window.

On GNOME Wayland, the bundled **OpenCode Notifier Jump Back** Shell extension is needed **only for the Jump to terminal action**. Normal notification popups, sounds, and existing focus suppression work without it.

A GNOME Shell extension is a small add-on to the GNOME desktop. This one remembers the terminal window where OpenCode started. When you press **Jump to terminal**, it asks GNOME to bring that exact window and its workspace forward. The existing focus detection can identify Ghostty but cannot activate its window on GNOME Wayland.

Install the extension on the GNOME computer displaying the notifications. With a remote OpenCode server, this means your local desktop. Installing the OpenCode plugin does not automatically install this desktop extension.

From this repository or the installed npm package directory, copy the extension files:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions/opencode-notifier@mohak34.github.io
cp gnome-shell-extension/extension.js gnome-shell-extension/metadata.json ~/.local/share/gnome-shell/extensions/opencode-notifier@mohak34.github.io/
```

Log out and back in so GNOME discovers the extension, then enable it:

```sh
gnome-extensions enable opencode-notifier@mohak34.github.io
```

Restart OpenCode while the terminal window you want to return to is focused. Leave `focusOnClick` enabled, its default setting, then use the notification's **Jump to terminal** button.

The extension targets GNOME Shell 45 through 50. The button appears when the plugin successfully captured a startup window through the extension. Automated checks cover the extension logic and communication, but window switching still needs validation on a real GNOME desktop.

On Notification Spec 1.2 servers (e.g. GNOME Shell 50), `notify-send` 0.8+ refuses `--action` mode (`Actions are not supported by this notifications server`), shows the popup without its button, and exits. When that happens, or when `notify-send` is missing, the plugin replaces the popup directly over D-Bus with one carrying the button and listens for the click with `dbus-monitor` (both must be on `PATH`; `gdbus` is already required for GNOME features). Set `OPENCODE_NOTIFIER_DEBUG=1` to log when the fallback triggers.

Notification delivery returns once `notify-send` prints the notification ID. The click listener lasts for the configured notification `timeout` plus a one-second grace period, then closes even if the notification daemon ignores expiry.

## Updating

### OpenCode 2

Check and update the configured package:

```sh
opencode plugin check @mohak34/opencode-notifier@latest
opencode plugin update @mohak34/opencode-notifier@latest
```

Use the exact configured target, such as `@beta`, when appropriate, then restart OpenCode. Exact versions stay pinned; change the version in your configuration to upgrade them. See [OpenCode 2 plugin management](https://opencode.ai/v2/docs/plugins).

V2 uses a separate cache layout under `~/.cache/opencode/npm/`. The V1 cleanup paths below do not refresh V2 packages.

### OpenCode 1

If you switch between `latest`, `beta`, or a pinned version and OpenCode still uses the old plugin, close OpenCode and remove the cached package. These paths assume the default cache root; adjust them if you set `XDG_CACHE_HOME`.

Linux/macOS:

```bash
rm -rf ~/.cache/opencode/packages/@mohak34/opencode-notifier*
rm -rf ~/.cache/opencode/node_modules/@mohak34/opencode-notifier
rm -f ~/.cache/opencode/bun.lock
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\@mohak34\opencode-notifier*" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\node_modules\@mohak34\opencode-notifier" -ErrorAction SilentlyContinue
Remove-Item -Force "$env:USERPROFILE\.cache\opencode\bun.lock" -ErrorAction SilentlyContinue
```

Then reopen OpenCode. It will download the plugin again. Older V1 releases used the shared `node_modules` cache; current V1 releases use `packages`.

### Pinning and checking versions

To avoid cache confusion while testing, pin the exact version in `opencode.json` instead of using a moving tag. On V1:

```json
{
  "plugin": ["@mohak34/opencode-notifier@x.y.z"]
}
```

On V2:

```json
{
  "plugins": ["@mohak34/opencode-notifier@x.y.z"]
}
```

Check the version published under a tag:

```bash
npm view @mohak34/opencode-notifier@latest version
npm view @mohak34/opencode-notifier@beta version
```

On current V1, check the cached version:

```bash
cat ~/.cache/opencode/packages/@mohak34/opencode-notifier@latest/node_modules/@mohak34/opencode-notifier/package.json | grep version
```

If you use `@beta` or a pinned version, replace `latest` in the path with `beta` or the exact version. Adjust the cache root if you set `XDG_CACHE_HOME`. On V2, use `opencode plugin check` as shown above.

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

**KDE Plasma: jumps to wrong terminal window or doesn't jump?**

Jump back feature tested on:

- KWin with default floating windows
- KWin + Krohnkite
- Ghostty and Konsole
- Warp
- OpenCode in tmux inside VS Code terminal

Most terminal emulators should work fine, but there can be exceptions.

Known limitations:

- Kitty is currently unsupported for this jump-back path (unstable focus targeting)
- Yakuake sessions are not supported for activity-specific jump-back behavior

You can still override manually (if needed) by pinning an explicit window ID:

```bash
export OPENCODE_NOTIFIER_WINDOW_ID="$(kdotool getactivewindow)"
opencode
```

Manual pinning bypasses heuristic window matching and should activate that exact window on notification action click.

**X11 deterministic jump-back**

- `xdotool` support is possible for the same startup pin behavior
- not implemented yet

**Windows: Custom sounds not working?**

- Must be .wav format (not .mp3)
- Use full Windows paths: `C:/Users/YourName/sounds/alert.wav` (not `~/`)
- Make sure the file actually plays in Windows Media Player
- WSL uses Linux sound players, so use a Linux-accessible path such as `/mnt/c/Users/YourName/sounds/alert.wav`

**Windows WSL notifications not working?**
The plugin sends WSL notifications through WindowsToaster. Check the Windows notification settings and icon path first. If toast delivery still fails, a PowerShell popup is an optional fallback.

On V2, this event command runs on the server. It requires a local Windows or WSL server with access to `powershell.exe` and the wrapper file. A remote Linux server cannot use this command to display a popup on your Windows computer; use the V2 terminal component for local alerts.

Save this wrapper as `C:\Users\YourName\bin\opencode-notifier-popup.ps1`:

```powershell
param(
  [string]$Message,
  [string]$Event
)

$wshell = New-Object -ComObject Wscript.Shell
$wshell.Popup($Message, 5, ("OpenCode - {0}" -f $Event), 0+64)
```

```json
{
  "notification": false,
  "sound": true,
  "command": {
    "enabled": true,
    "path": "powershell.exe",
    "args": [
      "-NoProfile",
      "-File",
      "C:\\Users\\YourName\\bin\\opencode-notifier-popup.ps1",
      "{message}",
      "{event}"
    ]
  }
}
```

**Windows: OpenCode crashes when notifications appear?**
If native notification delivery crashes OpenCode, disable native notifications and try the PowerShell wrapper above. On V2, the same server-location requirements apply:

```json
{
  "notification": false,
  "sound": true,
  "command": {
    "enabled": true,
    "path": "powershell.exe",
    "args": [
      "-NoProfile",
      "-File",
      "C:\\Users\\YourName\\bin\\opencode-notifier-popup.ps1",
      "{message}",
      "{event}"
    ]
  }
}
```

**Plugin not loading?**

- Check your `opencode.json` or `opencode.jsonc` syntax and use `plugin` for V1 or `plugins` for V2
- Clear the cache (see Updating section)
- Restart OpenCode

**Plugin installed but no notifications/sounds?**

- Check `suppressWhenFocused`: when `true` (default), notifications are skipped while OpenCode terminal is focused. Set to `false` to always notify.
- On V1, check `enableOnDesktop`: it defaults to `false`. On V2, Desktop/Web and headless clients use server commands; local sounds and popups require the terminal component described above.
- Follow the version-specific checks under [Updating](#updating). V1 and V2 use different cache layouts.

## TypeScript imports

Loading this plugin through OpenCode configuration does not require installing SDKs separately. If a TypeScript project imports the package directly, its declarations reference both OpenCode SDK generations. Install the optional type peers in that project:

```bash
bun add -d '@opencode-ai/plugin@^1.18.25' '@opencode/plugin@^2.0.18' '@opencode/client@^2.0.18'
```

These peers are optional to keep runtime-only installs lightweight. They are not automatically installed, so a V1-only TypeScript project importing the dual entrypoint also needs the V2 type peers. Adding peer metadata alone does not resolve missing type packages.

## Changelog

See [CHANGELOG.md](CHANGELOG.md)

## License

MIT
