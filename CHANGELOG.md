# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- optional custom command configurable (invoked for all events)
- minDuration: do not execute the custom command if elapsed time from prompt is under a threshold (default 0)
- Session completion notifications now only fire for main (primary) sessions
- Subagent (child) sessions completions have a dedicated subagent_complete event

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
