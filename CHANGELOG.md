# Changelog

All notable changes to this project will be documented in this file.

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
