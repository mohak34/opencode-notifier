# Behavior spec

What the plugin promises. The README explains every option; this file says how the parts must behave together. When intended behavior changes, change this file in the same commit.

## Hosts

One package serves two hosts. Users add the same package name; nothing selects a version.

| | OpenCode 1 | OpenCode 2 |
|---|---|---|
| Config key in `opencode.json` | `plugin` | `plugins` |
| Entry | default export `server` (`src/index.ts`) | default export `setup` (`src/v2.ts`) plus `./tui` (`src/tui.ts`) |
| Sound, popup, bell, focus | server plugin | terminal component |
| Event commands | server plugin, subject to focus suppression | server, once per event, even with no terminal open, not subject to focus |
| Click commands | server plugin | terminal component |

On V2 one server can feed several clients. Each client and the server plugin handle only events for sessions in their own directory and workspace, taken from the event's location or, when it has none, from the session. If the session lookup fails, the event is delivered.

## Events

| Event | Fires when | Default channels |
|---|---|---|
| `permission` | a tool needs approval | sound, popup |
| `complete` | a top-level session goes idle after work | sound, popup |
| `subagent_complete` | a child session finishes | none |
| `error` | a session fails | sound, popup |
| `user_cancelled` | the user aborts (ESC) | none |
| `question` | the question tool opens | sound, popup |
| `plan_exit` | the plan-exit tool runs | sound, popup |
| `session_started` | a new top-level session is created | sound |
| `user_message` | the user submits a message in a top-level session | sound |
| `client_connected` | best effort, on plugin or terminal start | sound |

`command` is on for every event by default but only runs when `command.enabled` is true. `bell` is off by default.

## Suppression

An event is delivered on a channel only if every check passes, in this order:

1. The event and channel are enabled in config.
2. `complete` and `subagent_complete`: the session ran longer than `minDuration`.
3. `complete` with `deferCompleteUntilChildrenIdle`: wait for tracked child sessions, at most `deferredCompleteTimeout`. A new parent run cancels the wait; an expired wait drops the alert.
4. `permission`: the request is still pending after a 300 ms grace (auto-approved requests stay silent), and the same request has not already alerted.
5. OpenCode 2 terminals: when several on one machine receive the same event, only the first to claim it delivers. The claim is a marker file in the user's temp directory; if it cannot be written, every terminal delivers.
6. Focus: with `suppressWhenFocused`, skip when the OpenCode terminal (and its pane, under tmux, WezTerm or Zellij) is in front. `true` skips every channel; a list of channels skips only those. Unknown focus means not focused.
7. Sound: at most one sound per second across all events.

## Guarantees

- No hook throws into or blocks the host. Failures are swallowed, and logged when `OPENCODE_NOTIFIER_DEBUG=1`.
- Focus detection fails open.
- A missing or invalid config file means defaults. Config path: `OPENCODE_NOTIFIER_CONFIG_PATH`, else `~/.config/opencode/opencode-notifier.json`.
- Unset new options reproduce the previous release's behavior.
- A volume of `0` skips playback on every platform.

## Release tracks

`vX.Y.Z-beta.N` tags publish to npm `beta`, `vX.Y.Z` tags to `latest`. Same code, different version string. A stable release follows a confirmed beta.
