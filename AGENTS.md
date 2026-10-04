# opencode-notifier

An OpenCode plugin that plays sounds, shows desktop notifications, rings the terminal bell and runs user commands when a session needs attention: permission asked, work done, error, question. One npm package, `@mohak34/opencode-notifier`, serves both OpenCode 1 and OpenCode 2 on macOS, Linux and Windows.

What it must do is in [SPEC.md](SPEC.md). Read it before changing behavior.

## What we never compromise on

### 1. Never break the host

The plugin runs inside someone's OpenCode session. A notifier bug must never crash, hang or slow it. Every hook catches its own errors; `src/index.never-throws.test.ts` holds that line. A slow external tool (`gdbus`, `powershell`, `hyprctl`) must not block the event loop.

### 2. Fail open

When we cannot tell whether the user is looking (unknown compositor, failed query, missing tool), we notify. A missed alert is worse than an extra one. Debug logging (`OPENCODE_NOTIFIER_DEBUG=1`) explains each decision instead of guessing silently.

### 3. Defaults stay stable

People install this once and forget it. A new option is off by default, or its default reproduces the old behavior exactly. Changing a default is a product decision for the maintainer, not a fix.

### 4. Both OpenCodes, every platform

The most common defect here is a change that works on the path you tested and is missing everywhere else. See [Hit every surface](#hit-every-surface).

## A small glossary

- **contributor** means anyone else opening a PR.
- **user** means the person who installed the plugin.
- **V1 / V2** mean OpenCode 1 and OpenCode 2, the two plugin hosts.
- **event** means one of the plugin's alert types (`permission`, `complete`, `error`, ...), not a raw OpenCode bus event.
- **channel** means one way of delivering an event: sound, notification (popup), bell, command.
- **suppression** means deciding not to deliver: focus, `minDuration`, dedupe, rate limit.
- **focus backend** means the platform-specific check for "is the OpenCode terminal in front" (Hyprland, KDE, GNOME AT-SPI, Windows, tmux, ...).

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f` or kill by matching a name. Your own agent and the user's OpenCode both match "opencode". Kill only a PID you started.
2. **Touching the user's real setup.** Tests and manual checks use a temp config through `OPENCODE_NOTIFIER_CONFIG_PATH`. Never edit `~/.config/opencode/opencode-notifier.json` or `opencode.json`, and never install the GNOME extension or change system notification settings on the machine you run on.
3. **Firing real notifications in tests.** Tests stub the delivery layer. A test that pops a real toast, plays a sound or steals focus is broken (see the macOS skip in the terminal-focus smoke test).

## Hit every surface

Before calling a change done, walk this list and say in the PR which entries applied:

- **Hosts.** V1 (`src/index.ts`, server plugin) and V2 (`src/v2.ts` server setup plus `src/tui.ts` terminal component). On V2, sounds, popups, bells and focus run in the terminal; event commands run on the server. A feature needs a decision for each host, even if it is "V1 only".
- **Platforms.** macOS (AppleScript, `node-notifier`), Linux (`notify-send`, D-Bus fallback), Windows and WSL (`snoretoast`, PowerShell). Windows only plays `.wav`.
- **Focus backends.** A change to focus logic touches every backend in `src/focus.ts` and `src/focus-windows.ts`, plus the tmux, WezTerm and Zellij pane checks.
- **Channels.** Sound, notification, bell, command, and the click command. A new event or option needs a default for each.
- **Config.** New options go in `src/config.ts` with a default, a test in `src/config.test.ts`, and a README entry under All options.
- **Docs.** README for anything a user configures or sees; CHANGELOG for every user-visible change.

## Commands

- `bun install`
- `bun test <files>` for the tests you touched. `bun run typecheck` when types changed.
- `bun run build` writes `dist/`. Never commit `dist/`.
- Do not run the whole suite to prove a one-file change. CI runs everything on release tags.

## Verifying

- Smallest proof that the change works: the focused test for the behavior, plus a manual run when it touches delivery.
- Manual run: point `OPENCODE_NOTIFIER_CONFIG_PATH` at a temp file, load the built plugin from a local path in a scratch project's `opencode.json`, trigger the event.
- You can only test the platform you are on. Say which platforms you checked and which you could not. Windows, macOS and GNOME changes need a contributor or the maintainer to confirm on real hardware before release. Mark untested paths "Untested" in the README platform table.

## Pull requests

- The maintainer's own agents never open a PR unless asked. Contributors' agents follow CONTRIBUTING.md.
- Conventional commit title in plain language: `fix(windows): alerts no longer muted by unrelated terminals`.
- Body: what was broken or missing (link the issue), how the fix works in a few sentences, what you checked and what you could not. No code or diff excerpts; GitHub already shows the diff. End with the model and harness that did the work.
- One problem per PR.
- Fixing a contributor's PR: commit on top of their branch so their commits and authorship stay. Never squash their work into yours. Credit them in the CHANGELOG Contributors section.

## Releases

Publishing is a tag push. CI (`.github/workflows/release-beta.yml`, which handles both tracks) runs typecheck, tests and build, then publishes to npm with OIDC; there is no token.

Never tag or release on your own. Run these steps only when the maintainer asks for a specific version ("release 0.8.0-beta.0", "tag 0.8.0"):

- **Beta** `X.Y.Z-beta.N`: commit `chore: prepare X.Y.Z-beta.N release` (bump `package.json`, move CHANGELOG `[Unreleased]` into a dated section), tag `vX.Y.Z-beta.N`, push the commit and tag. npm dist-tag `beta`.
- **Stable** `X.Y.Z`: same with `chore: prepare X.Y.Z release` and tag `vX.Y.Z`. npm dist-tag `latest`.
- Then create the GitHub release for the tag with that version's CHANGELOG section as the notes (`gh release create vX.Y.Z --notes-file ...`), betas marked `--prerelease`.
- Watch the CI run and report whether npm published.

CHANGELOG style: Keep a Changelog sections (`Added`, `Fixed`, `Documentation`, `Upgrade notes`, `Contributors`). One sentence per entry describing what the user sees, then the PR and issue numbers: `(#128; issue #127)`. Upgrade notes say what stays the same for people who change nothing.

## Documentation

- README is the user guide. Update the section for what changed; do not append a second account of the new behavior.
- `SPEC.md` holds the behavior contract. Change it when intended behavior changes, in the same commit.
- Do not commit plans, research notes or scratch files.

## Where code lives

- `src/index.ts`: V1 server plugin and the package's default export (V1 `server` plus V2 `setup`).
- `src/v2.ts`: V2 server setup and the adapter that feeds V2 events into the shared notifier.
- `src/tui.ts`: V2 terminal component, the `./tui` export. Local delivery on V2.
- `src/notifier.ts`: host-independent session state: busy and idle, child sessions, deferred completion, permission grace.
- `src/delivery.ts`: turns one event into channel deliveries, applying config and suppression.
- `src/notify.ts`, `src/sound.ts`, `src/bell.ts`, `src/command.ts`: the four channels.
- `src/focus.ts`, `src/focus-windows.ts`: focus backends and pane checks.
- `src/config.ts`: config schema, defaults, loading.
- `gnome-shell-extension/`: optional GNOME Shell bridge for focus and jump-back.
