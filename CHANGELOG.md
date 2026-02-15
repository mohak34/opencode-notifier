# Changelog

All notable changes to this project will be documented in this file.

## [0.1.20] - Unreleased

### Added
- `sound-toggle` custom tool - Enable, disable, toggle, or check sound status directly from OpenCode
- Use natural language: "Use sound-toggle to disable sounds" or "Use sound-toggle to check status"
- Config file path can be overridden via `OPENCODE_NOTIFIER_CONFIG_PATH` environment variable for testing

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
