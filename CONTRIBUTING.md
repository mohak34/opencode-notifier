# Contributing

Thanks for helping. This is a one-maintainer project, so review time is limited. Following this guide gets your PR reviewed faster; it does not guarantee a merge.

## Before you start

- **Bugs:** open an issue first unless the fix is small and obvious. Include your OS, desktop or compositor, terminal, OpenCode version (1 or 2), plugin version, and the output with `OPENCODE_NOTIFIER_DEBUG=1`.
- **Features and new options:** open an issue and wait for a yes on the direction before writing code. Unsolicited features and rewrites are usually declined.
- **Platform reports are welcome.** If you test a platform marked "Untested" in the README and it works or fails, open an issue.

## Setup

```bash
bun install
bun test
bun run typecheck
bun run build
```

To try your build in OpenCode, point a scratch project's `opencode.json` at your local checkout and use a throwaway config through `OPENCODE_NOTIFIER_CONFIG_PATH`.

## Rules for a PR

- **One problem per PR.** Split unrelated fixes.
- **Both OpenCode versions.** Say whether your change affects OpenCode 1, 2, or both, and why.
- **Defaults stay the same.** New options are off by default or keep today's behavior when unset.
- **Never break the host.** Plugin code must not throw into or block OpenCode.
- **Tests:** add a focused test for the behavior you changed. Tests must not fire real notifications, play sounds, or steal focus.
- **Docs:** update the README section and add a CHANGELOG entry under `[Unreleased]`.

## Evidence

Tell us how to reproduce the bug, what you ran to check your fix, and which OS, desktop and terminal you tested on. "Tests pass" is not enough. For visual changes, attach a screenshot to the PR instead of committing it.

## What happens next

The maintainer may push fixes on top of your branch rather than ask for another round. Your commits and authorship stay, and you are credited in the CHANGELOG and release notes. Releases go out as a beta first, then stable.

Using an agent is fine. Say which model and tool did the work at the end of the PR description.
