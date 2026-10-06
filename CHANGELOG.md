# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- `suppressWhenFocused` accepts a list of channels, so `["notification"]` hides popups while the terminal is focused but still plays sounds (issue #135).

### Fixed

- Windows focus suppression applies only when the window hosting OpenCode is in front, instead of whenever any terminal or editor is. Another terminal window, File Explorer, or an unrelated VS Code window no longer silences alerts. Uncertain cases deliver the alert, and `OPENCODE_NOTIFIER_DEBUG=1` logs each Windows decision (#130).
- A sound volume of `0` skips playback on every platform without blocking the next audible sound (#130).
- OpenCode 2: when several clients share one server, a finished session alerts only the client in that session's project, instead of every client under its own project name (issue #132).
- OpenCode 2: several terminals on one computer showing the same session alert once per event instead of once per terminal. Terminals on different computers still each alert (issue #138).

### Documentation

- Windows troubleshooting for toasts hidden by Do Not Disturb or popup blockers, a note to keep custom sounds outside OpenCode's cache, and a note that debug output is not visible in the OpenCode 2 terminal UI (issue #130).

### Upgrade notes

- `true` and `false` work as before.

## [0.7.0] - 2026-10-03

### Fixed

- Linux: clickable notification actions survive `notify-send` versions that refuse `--action` mode (issue #106).
  - `notify-send` 0.8+ reports "Actions are not supported by this notifications server" on Notification Spec 1.2 servers (e.g. GNOME Shell 50), shows the popup without its button, and exits, so **Jump to terminal** / **Run command** never fired.
  - When that happens (or `notify-send` is missing), the plugin replaces that popup over D-Bus (`org.freedesktop.Notifications.Notify`) with one carrying the action and watches `ActionInvoked` with `dbus-monitor` for the click. Requires `gdbus` and `dbus-monitor` on `PATH` (both already required for GNOME focus features).

### Contributors

- Thanks to @LiberiFatali for the D-Bus action fallback on GNOME 50 in #129.

## [0.6.1] - 2026-10-03

### Fixed

- Hyprland click-to-focus works on Lua configs (Hyprland 0.55+). The legacy `focuswindow` dispatch is tried first and falls back to `hl.dsp.focus` when Hyprland rejects it. Focus suppression was unaffected.

## [0.6.0] - 2026-09-30

### Added

- `notificationTitle` to customize the entire popup title with `{projectName}`, `{sessionTitle}`, `{agentName}`, `{timestamp}`, and `{turn}` placeholders on OpenCode 1 and 2 (#128; issue #127).

### Fixed

- Custom title templates that become empty after interpolation fall back to the default title, including when session titles are disabled or session context is unavailable.

### Documentation

- Corrected V1/V2 update instructions, WSL configuration and fallback guidance, and sound, bell, focus, and platform option descriptions in the README.

### Upgrade notes

- Leaving `notificationTitle` unset preserves the existing `OpenCode (<project>)` or `OpenCode` title. A nonempty custom title overrides `showProjectName`; `{sessionTitle}` still requires `showSessionTitle: true`.
- `0.6.0` and `0.6.0-beta.0` contain the same implementation and differ only in the package version. They publish to npm's `latest` and `beta` dist-tags respectively.

### Contributors

- Thanks to @cardin for configurable notification title templates in #128.

## [0.6.0-beta.0] - 2026-09-30

### Added

- Same implementation as v0.6.0, with the prerelease package version for npm's `beta` dist-tag.

## [0.5.0] - 2026-09-30

### Added

- Zellij pane-aware focus suppression, including sessions with multiple attached clients (#126; issue #95).
- Optional `deferCompleteUntilChildrenIdle` and `deferredCompleteTimeout` settings to delay one parent completion until known native child sessions and descendants finish (#126; issue #87).
- GNOME Wayland **Jump to terminal** action through the bundled OpenCode Notifier Jump Back Shell extension (#126; issue #106).
- `onClickCommand` to run a local script when a notification is activated, with the originating session context. `focusOnClick` controls built-in jump-back separately (#126; issue #97).
- `{sessionID}` placeholder for custom command paths and arguments (#124).

### Fixed

- V1 question and plan-ready commands receive their triggering session ID.
- Linux notification delivery finishes when the notification ID is returned, while the click listener remains active for the configured timeout plus one second.
- Duplicate and close notification actions do not rerun click commands.
- Command test fixtures use the running executable for platform portability. The terminal-focus smoke test skips macOS to avoid stealing focus during tests (#125).

### Upgrade notes

- `deferCompleteUntilChildrenIdle` and `onClickCommand` are disabled by default. Existing behavior stays unchanged until enabled.
- Child completion tracking covers native OpenCode session lifecycle events. Third-party delegation without those events and work already running when the plugin starts cannot be tracked reliably. Pending completions are dropped at timeout.
- The GNOME Shell extension is required only for **Jump to terminal**. Normal popups, sounds, and existing focus suppression work without it. Install and enable it on the GNOME computer displaying the notification, then restart OpenCode while the intended terminal is focused. See the README installation instructions.
- The extension targets GNOME Shell 45 through 50. Its logic and communication passed automated checks; live GNOME desktop window switching still needs validation.
- Linux notification actions use an explicit button. macOS click commands require `node-notifier`; AppleScript and Ghostty OSC notifications do not provide click callbacks.
- On V2, click commands run in the local terminal component. Event commands continue to run on the server.
- `0.5.0` and `0.5.0-beta.0` contain the same implementation and differ only in the package version. They publish to npm's `latest` and `beta` dist-tags respectively.

### Contributors

- Thanks to @pedropombeiro for the `{sessionID}` placeholder and macOS focus-test fix in #124 and #125.

## [0.5.0-beta.0] - 2026-09-30

### Added

- Same implementation as v0.5.0, with the prerelease package version for npm’s `beta` dist-tag.

## [0.4.1-beta.0] - 2026-09-28

### Added

- Published the v0.4.0 code as v0.4.1-beta.0 for users on npm’s `beta` dist-tag.

## [0.4.0] - 2026-09-28

### Added

- OpenCode 2 support alongside OpenCode 1 in the same package (#113, #123).
- V2 terminal component for local sounds, desktop popups, bells, and focus detection. Existing custom notification commands run on the server, including when no terminal is open.

### Fixed

- V2 event handling for completion, errors, cancellation, questions, and pending permissions (#123).
- V2 duration thresholds, subagent names, duplicate user-message alerts, and project switching. Deleted child sessions retain their classification (#123).
- Published TypeScript declarations now declare their SDK dependencies as optional peers. Runtime users do not need to install the SDKs (#123).

### Upgrade notes

- OpenCode 1 keeps using the `plugin` configuration key. OpenCode 2 uses `plugins` and loads the terminal component automatically.
- V2 local alerts require the interactive terminal. Headless runs and Desktop/Web clients can still use server commands.
- To avoid duplicate V2 alerts, add `"-opencode.notifications"` to your existing `plugins` list in `~/.config/opencode/cli.json`.
- `plan_exit` remains available on V1 and is inactive on V2. Direct TypeScript consumers of the dual entrypoint need both SDK generations installed, as documented in the README.

### Contributors

- Thanks to @paterkleomenis for the original dual-version implementation in #113. Their commit is preserved in #123.

## [0.3.1] - 2026-09-27

### Fixed
- Deleted child sessions no longer fire a top-level `complete` notification (#116; issue #108)
  - Failed session lookups are treated as unknown and skipped instead of misclassified
  - `session.deleted` keeps subagent ids as tombstones until the periodic cleanup prunes them
- Notification side effects can no longer crash the host (#117; issue #25)
  - The `event`, `permission.ask`, and `tool.execute.before` hooks fail silent on unexpected payloads
  - Fire-and-forget command spawn is guarded against synchronous throws
- Coalesced stacked sounds across events: max one sound per second (#119; issue #52)
  - Events with no sound file no longer consume the shared slot
- Locked Windows toast options to the `appName` key (regression test; issue #114)

## [0.3.0-beta.0] - 2026-09-21

### Added
- Linux GNOME Wayland: `suppressWhenFocused` now works via AT-SPI focus detection (#105, follow-up #111; issues #83, #104)
  - GNOME exposes no compositor focus API and `xdotool` cannot see native Wayland windows, so the backend reads the AT-SPI `ACTIVE` state bit over `org.a11y.Bus` (requires `gdbus`)
  - Ghostty is matched by its `/com/mitchellh/ghostty` AT-SPI path, other terminals by app name (including the `gnome-terminal-server` AT-SPI alias)
  - Window identity is `bus@path` since AT-SPI object paths repeat across D-Bus bus names
  - Unknown window roles are excluded so a failed lookup fails open instead of suppressing a notification
  - Implemented and verified on Ubuntu 26.04.1 LTS + GNOME Shell 50.1 + Ghostty 1.3.0
  - Previously GNOME sessions always fell back to notifying (and with `notificationSystem: ghostty`, Ghostty hid its own banner while plugin sounds still played)
- Permission notifications are skipped when the request was auto-approved (#98, follow-up #112; issue #94)
  - On `permission.asked` the plugin waits 300ms and only notifies if the request is still pending; any lookup failure notifies (fail-open)
  - The shared dedupe window is claimed only when a notification actually fires, so a skipped auto-approved request no longer mutes a real one
- Added `OPENCODE_NOTIFIER_DEBUG=1` to log the focus backend decision (backend, `cached`/`current` window, session, result)
- README: install shortcut via `opencode plug -g @mohak34/opencode-notifier` (#99)

### Fixed
- Windows: PowerShell sound playback uses `-EncodedCommand` so args never contain spaces (#101)
- Security hardening: no child process is spawned through a shell anymore (#100)
  - All `execFileSync` calls use argv arrays with `shell: false`
  - Window IDs are validated before use; KWin socket uses `mkdtemp`; Ghostty fields are sanitized
- KDE: `qdbus` is resolved via `PATH` scan (including Fedora's versioned names) without invoking a shell (#103, #109)

## [0.2.8] - 2026-06-05

### Fixed
- Windows: PowerShell `-WindowStyle Hidden` no longer minimizes the parent terminal (#80)
  - Replaced `-WindowStyle Hidden` with Node.js `windowsHide: true` flag
  - Prevents both the console flash and terminal minimization

## [0.2.7] - 2026-05-21

### Added
- macOS: New `suppressGhosttySound` option to skip duplicate audio with Ghostty notifications (#78)
  - Set to `true` to prevent the plugin's sound from playing alongside macOS Notification Center's default sound
  - Only affects default (bundled) sounds — custom sounds still play
  - Disabled by default for backward compatibility

## [0.2.6] - 2026-05-14

### Fixed
- Windows: Hide PowerShell console window during focus checks (#77)
  - Added `-WindowStyle Hidden` to `powershell`/`pwsh` spawns in `getWindowsActiveWindowId()`
  - Prevents visible terminal flashes on every notification event
- SSH: Skip notification if D-Bus session bus is unavailable (#73)
  - Added `DBUS_SESSION_BUS_ADDRESS` check before calling `notify-send`
  - Prevents 60-second hang when running over SSH without a desktop session

## [0.2.5] - 2026-05-09

### Added
- New `showFullPath` config option (#72)
  - Set to `true` to show the full absolute path in notification titles and the `{projectName}` token
  - Defaults to `false`, preserving the existing folder-name behavior
  - Useful when working across multiple projects with the same folder name

## [0.2.4] - 2026-04-28

### Fixed
- **Tmux Multi-client Focus:** Fixed an issue where `suppressWhenFocused` failed to suppress notifications in `tmux` if multiple clients were attached to the same session. (#71)
- **Minimum Duration Lookup:** Fixed a bug where top-level `minDuration` failed to suppress notifications because elapsed time was only calculated when custom command durations were set. (#68)

### Documentation
- Updated cache paths and troubleshooting steps in the README.
- Added missing configuration option docs and fixed broken markdown links.

## [0.2.3] - 2026-04-21

### Added
- KDE Plasma notification jump-back action (#67)
  - Click "Jump to terminal" button on KDE notifications to focus the terminal
  - Uses kdotool or KWin scripts for focus routing
  - Captures startup window ID for deterministic jump-back
- WSL support (#65)
  - Detects WSL and routes notifications through Windows SnoreToast
  - Adds `customIconPath` config for Windows-native icon paths
- Minimum duration threshold for DONE notifications (#68)
  - New top-level `minDuration` config option (default: 0)
  - Suppresses `complete` and `subagent_complete` events when session finishes faster than threshold
  - Independent of `command.minDuration`

### Fixed
- tmux focus fallback when window detection fails (#69)
  - Uses tmux pane state as best-effort fallback on Linux setups where window focus is unavailable
  - Fixes `suppressWhenFocused` for GNOME Wayland + tmux users

## [0.2.2] - 2026-04-12

### Added
- New terminal bell channel (`bell`) with global and per-event controls (#56)
  - Global toggle: `bell`
  - Per-event toggle: `events.<event>.bell`
  - Emits terminal BEL (`\x07`) with TTY-safe behavior

### Fixed
- Added support for `plan_exit` notifications as a dedicated event (#59)
- macOS WezTerm focus detection now matches `wezterm-gui` frontmost app name reliably (#64)

### Changed
- README now documents bell behavior and quick validation command (`printf '\\a'`)
- Added regression tests for bell config/dispatch and WezTerm macOS focus mapping

## [0.2.1] - 2026-04-01

### Fixed
- Guard `{agentName}` extraction against non-string session titles (#57)
  - Prevents runtime `TypeError` when upstream session title data is not a string
  - Safely normalizes session title to `string | null` before placeholder extraction
  - Adds regression tests for non-string title inputs

## [0.2.0] - 2026-03-30

### Added
- WezTerm pane-aware focus suppression (#54)
  - Uses `WEZTERM_PANE` with `wezterm cli list-clients --format json`
  - Suppresses alerts only when your current WezTerm pane is focused
- New `{agentName}` placeholder for notifications and command args (#51)
  - Extracted from subagent session title suffix `(@name subagent)`
  - Resolves to empty string for non-subagent sessions
- Linux Niri focus detection support (#53)
  - Uses `niri msg --json focused-window` when `NIRI_SOCKET` is present

### Fixed
- tmux focus suppression hardening
  - Pane focus check now uses safer `tmux display-message` argument execution
  - Missing or failed tmux pane probe now fails open (notify instead of silent suppression)
- macOS focus suppression when running inside tmux (#50)
  - Handles `TERM_PROGRAM=tmux`/`screen` fallback correctly for terminal app matching
- Ghostty notifications inside tmux
  - Uses tmux passthrough wrapping for OSC 9 payloads so visual notifications render inside tmux
- Permission notification routing dedupe
  - Prevents duplicate permission alerts when both `permission.asked` event and `permission.ask` hook fire close together

### Changed
- Focus detection docs now match implementation details for tmux and WezTerm
- Added test coverage for WezTerm pane parsing and recently hardened focus paths

## [0.1.36] - 2026-03-24

### Fixed
- Remove legacy `permission.updated` handler to prevent duplicate sounds on Windows (#52)
  - The handler fired on every permission state change (asked + resolved), causing double sounds when the user took >1s to respond
  - `permission.asked` event and `permission.ask` hook already cover all modern OpenCode versions

## [0.1.35] - 2026-03-17

### Fixed
- macOS terminal focus detection now correctly identifies the frontmost app (#49)
  - Previously used window ID matching which failed when the terminal wasn't the active window
  - Now uses `osascript` to get the frontmost app name and checks against known terminal emulators
  - Supports Terminal, iTerm2, Ghostty, WezTerm, Alacritty, Kitty, Hyper, Warp, Tabby, Cursor, VS Code, Zed, Rio
  - Falls back to checking all known terminal names if `TERM_PROGRAM` is unset

## [0.1.34] - 2026-03-17

### Added
- New `enableOnDesktop` config option (#48)
  - Set to `true` to run the plugin on Desktop and Web clients (default: false)
  - By default, the plugin only runs on CLI to avoid duplicate notifications with Desktop's built-in notifications
  - When enabled, you get sounds, notifications, and custom commands on Desktop/Web
  - Useful if you want custom commands (Telegram, webhooks) but don't care about built-in notifications

### Fixed
- Windows active window detection now works correctly (#49) - @normanre
  - Previously the PowerShell here-string was incorrectly collapsed, causing detection to always fail
  - Now uses `-MemberDefinition` one-liner with proper `execFileSync` args array
  - Falls back to `pwsh` if `powershell` is not available

## [0.1.33] - 2026-03-16

### Added
- Per-event `command` flag in events config to control whether the custom command runs for a specific event (#47) - @Odonno
  - Defaults to `true` for all events (backwards compatible)
  - Example: set `"command": false` on `subagent_complete` to suppress the command without affecting sound/notification

### Fixed
- Linux notifications now show `opencode` as the app name instead of the default `notify-send` label (#46) - @rhajizada
- mpv sound player no longer triggers the autoload script, preventing multiple sounds from playing at once (#42) - @ekisu

## [0.1.32] - 2026-03-10

### Fixed
- Plugin now correctly runs in CLI mode when `OPENCODE_CLIENT` is not set in the environment — previously `undefined !== "cli"` caused the plugin to silently return without firing any notifications

## [0.1.31] - 2026-03-10

### Fixed
- Ghostty notifications now use OSC 9 instead of OSC 777 — previously sent an unsupported sequence resulting in only a bell sound with no desktop notification banner (#38) - @raeperd
- Bundled `dist/index.js` no longer contains absolute source file paths from the build machine (#40) - @xxNull-lsk

### Changed
- Plugin no longer runs on Desktop and Web clients, which have built-in notification support (#39) - @ZTzTopia

## [0.1.30] - 2026-03-04

### Added
- New `suppressWhenFocused` config option to suppress notifications when the terminal running OpenCode is focused
- Works across all platforms: Hyprland, Sway, KDE Wayland, X11, macOS, Windows
- Full tmux support with session/window/pane awareness

### Fixed
- **Ghostty multi-window support:** Replaced PID-based detection with window ID comparison
  - Notifications now correctly trigger when switching between Ghostty windows
  - Ghostty uses a single process for all windows, so PID detection was matching any Ghostty window
- **tmux session awareness:** Fixed detection when switching between tmux sessions

### Known Limitations
- Ghostty native tabs (without tmux) cannot be distinguished — Ghostty does not yet expose a tab query IPC API ([ghostty-org/ghostty#2353](https://github.com/ghostty-org/ghostty/issues/2353))

### Technical Changes
- New `src/focus.ts` module for cross-platform window focus detection
- Complete rewrite of focus detection logic (288 lines → 118 lines)
- No longer uses process ancestry walking

## [0.1.28] - 2026-02-23

### Fixed
- Fix Linux notification grouping not showing notifications on GNOME (#33)
- Removed `--app-name` flag from direct `notify-send` calls that caused GNOME to suppress notifications

## [0.1.27] - 2026-02-23

### Added
- Linux notification grouping support (#33)
- New `linux.grouping` config option to replace notifications in-place instead of stacking
- Auto-detects `notify-send` 0.8+ capabilities, falls back to default behavior on older systems
- Works with GNOME, dunst, mako, swaync on both X11 and Wayland

## [0.1.26] - 2026-02-19

### Fixed
- Suppress completion sounds immediately after error events (#31)

## [0.1.24] - 2026-02-19

### Removed
- Reverted `sound-toggle` feature from v0.1.23 (#27)
- Removed `sound-toggle` custom tool and related code
- Kept all v0.1.20-0.1.22 features intact (volumes, session titles, interrupted events)

## [0.1.22] - 2026-02-18

### Added
- New `interrupted` event for when sessions are cancelled (e.g., Esc pressed) (#29) - @minpeter
- Shows "Session was interrupted" instead of duplicate error+completion notifications
- Only one sound plays when interruption is detected
- Auto-cleanup of error tracking to prevent memory leaks
- Fix placeholder interpolation so `{sessionTitle}` is removed when disabled

### Changed
- Restored PR #29's 350ms delay and 4-map tracking for reliable race handling
- Added cleanup for session maps to avoid leaks

## [0.1.21] - 2026-02-18

### Added
- Session title in notification messages (#28) - @cristianmiranda
- New `showSessionTitle` config option (default: false)
- New `{sessionTitle}` placeholder for notification messages
- New `{projectName}` token support in custom command args
- Session title pre-loading for better performance on error events

### Notes
- Session titles are disabled by default to avoid large notification text

## [0.1.20] - 2026-02-18

### Added
- Per-event sound volume configuration (#30) - @minpeter
- New `volumes` config option to set individual volume levels (0-1) for each event type
- Supported on macOS and Linux (Windows plays at full volume)
- Volume values are automatically clamped to valid range (0-1)
- Default volume is 100% (1.0) for all events when not specified

## [0.1.19] - 2026-02-12

### Added
- macOS notification system selector (#23)
- `notificationSystem` config option: `"osascript"` (default, reliable) or `"node-notifier"` (icons)
- Choose between reliable notifications (osascript) or custom icons (node-notifier) on macOS

## [0.1.18] - 2026-02-06

### Added
- Icon support for notifications on Windows and Linux
- OpenCode logo displays in system notifications
- New `showIcon` config option (default: true)

### Notes
- macOS uses osascript which doesn't support custom icons (shows Script Editor icon)

## [0.1.15] - 2026-01-20

### Fixed
- README now shows correct default message for `subagent_complete`

## [0.1.14] - 2026-01-20

### Added
- Custom command execution for events with `{event}` and `{message}` token substitution
- `command.minDuration` option to skip command if response time is below threshold
- New `subagent_complete` event for subagent session completions (disabled by default)

### Changed
- `complete` event now only fires for main (primary) sessions
- Elapsed time for `minDuration` now measures time since last user prompt

### Fixed
- Config parsing for `subagent_complete` now supports top-level format

## [0.1.13] - 2026-01-14

### Added
- Show project folder name in notification title (closes #12)
- New config option `showProjectName` (default: true)

### Changed
- Default messages now use "Session" prefix instead of "OpenCode" to avoid repetition

### Fixed
- Config parsing for `question` event now supports top-level format

## [0.1.12] - 2026-01-14

### Added
- Notification and sound when the `question` tool is invoked (closes #14)

## [0.1.11] - 2026-01-14

### Changed
- Sounds now enabled by default (aligns with documented behavior)

### Fixed
- Improved bundled sound file path resolution for different installation structures

## [0.1.10] - 2026-01-04

### Fixed
- macOS notifications now use native `osascript` instead of `node-notifier` (fixes notifications not showing)

### Added
- `permission.ask` hook for more stable permission notifications

## [0.1.9] - 2026-01-04

### Added
- Growl fallback for macOS notifications (`withFallback: true`)

## [0.1.8] - 2026-01-04

### Fixed
- Support both `permission.updated` (OpenCode v1.0.223 and earlier) and `permission.asked` (OpenCode v1.0.224+) events
- macOS notifications now work across all OpenCode versions

### Changed
- Updated `@opencode-ai/plugin` dependency to `^1.0.224`

### Added
- Improved installation and updating instructions in README
- Troubleshooting section in README

## [0.1.7] - 2026-01-03

### Fixed
- Windows sound playback using correct PowerShell syntax

## [0.1.6] - 2026-01-03

### Fixed
- Linux duplicate notifications with debounce logic

## [0.1.5] - 2026-01-02

### Added
- Initial release with notification and sound support
- Cross-platform support (macOS, Linux, Windows)
- Configurable events, messages, and custom sounds
