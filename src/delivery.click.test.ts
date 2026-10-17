import { afterAll, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { delimiter, join } from "path"
import isWsl from "is-wsl"

const fixtureRoot = mkdtempSync(join(tmpdir(), "notifier-click-command-test-"))
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }))

test("configured notification titles reach the popup backend", async () => {
  const directory = mkdtempSync(join(fixtureRoot, "title-"))
  const configPath = join(directory, "config.json")
  const configModule = join(import.meta.dir, "config.ts")
  const deliveryModule = join(import.meta.dir, "delivery.ts")
  const notifierModule = join(import.meta.dir, "notifier.ts")
  const script = `
    const { writeFileSync } = await import("node:fs")
    const { loadConfig } = await import(${JSON.stringify(configModule)})
    const { handleEvent } = await import(${JSON.stringify(deliveryModule)})
    const { createNotifier } = await import(${JSON.stringify(notifierModule)})
    for (const [index, options] of [
      {},
      { showProjectName: false },
      { notificationTitle: "{projectName}: {sessionTitle} ({agentName}) #{turn} at {timestamp}", showProjectName: false, showSessionTitle: true },
      { notificationTitle: "My Assistant" },
      { notificationTitle: "{sessionTitle}", showSessionTitle: false },
      { notificationTitle: "{sessionTitle}", showSessionTitle: false, showProjectName: false },
    ].entries()) {
      writeFileSync(${JSON.stringify(configPath)}, JSON.stringify({ ...options, sound: false, suppressWhenFocused: false, focusOnClick: false, showIcon: false, notificationSystem: "ghostty", command: { enabled: false }, messages: { question: "Question " + index } }))
      await handleEvent(loadConfig(), "question", "my-project", null, "Fix login", "ses_title", "build")
    }
    writeFileSync(${JSON.stringify(configPath)}, JSON.stringify({ notificationTitle: "{sessionTitle} by {agentName}", showSessionTitle: true, sound: false, suppressWhenFocused: false, focusOnClick: false, showIcon: false, notificationSystem: "ghostty", command: { enabled: false }, messages: { question: "Question 6" } }))
    const notifier = createNotifier({ info: async () => ({ isChild: false, title: "From lookup", agentName: "builder" }), elapsed: async () => null, permissionPending: async () => true }, "/workspace/my-project", "terminal")
    await notifier.notify("question", "ses_title")
    notifier.dispose()
    writeFileSync(${JSON.stringify(configPath)}, JSON.stringify({ notificationTitle: "{sessionTitle} | {agentName}", showSessionTitle: true, sound: false, suppressWhenFocused: false, focusOnClick: false, showIcon: false, notificationSystem: "ghostty", command: { enabled: false }, messages: { question: "Question 7" } }))
    await handleEvent(loadConfig(), "question", "my-project")
  `
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...process.env, OPENCODE_NOTIFIER_CONFIG_PATH: configPath },
    stdout: "pipe", stderr: "pipe",
  })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  expect(await new Response(child.stdout).text()).toMatch(
    /^\x1b\]9;OpenCode \(my-project\): Question 0\x07\x1b\]9;OpenCode: Question 1\x07\x1b\]9;my-project: Fix login \(build\) #3 at \d{2}:\d{2}:\d{2}: Question 2\x07\x1b\]9;My Assistant: Question 3\x07\x1b\]9;OpenCode \(my-project\): Question 4\x07\x1b\]9;OpenCode: Question 5\x07\x1b\]9;From lookup by builder: Question 6\x07\x1b\]9;OpenCode \(my-project\): Question 7\x07$/
  )
})

// Popups with actions go through D-Bus, so each case runs against the fixture daemon on a
// private bus (never the user's desktop). A fake notify-send catches the plain fallback.
// WSL reports linux but delivers through WindowsToaster, which would pop real toasts.
const daemonFixture = join(import.meta.dir, "../test/fixtures/notification-daemon.ts")
for (const scenario of [
  { name: "click commands retain session context and run once on an explicit action", enabled: true, actions: ["focus-terminal", "focus-terminal", "close"], runs: true },
  { name: "closing a notification does not run its click command", enabled: true, actions: ["close"], runs: false },
  { name: "disabled click commands do not run", enabled: false, actions: ["focus-terminal"], runs: false },
]) test.skipIf(process.platform !== "linux" || isWsl)(scenario.name, async () => {
  const directory = mkdtempSync(join(fixtureRoot, "case-"))
  const output = join(directory, "argv.json")
  const configPath = join(directory, "config.json")
  const executable = join(directory, "notify-send")
  const recorder = join(directory, "record.mjs")
  writeFileSync(recorder, 'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)) + "\\n")')
  writeFileSync(executable, "#!/bin/sh\nexit 0\n")
  chmodSync(executable, 0o755)
  writeFileSync(configPath, JSON.stringify({
    sound: false, bell: false, suppressWhenFocused: false, focusOnClick: false,
    command: { enabled: false },
    messages: { question: "Question for {sessionTitle}" },
    showSessionTitle: false,
    onClickCommand: { enabled: scenario.enabled, path: process.execPath, args: [recorder, output, "{event}", "{sessionID}", "{sessionTitle}"] },
  }))
  const notifierModule = join(import.meta.dir, "notifier.ts")
  const notifyModule = join(import.meta.dir, "notify.ts")
  const script = `
    const daemon = await import(${JSON.stringify(daemonFixture)})
    const { createNotifier } = await import(${JSON.stringify(notifierModule)})
    const { disposeLinuxNotifications } = await import(${JSON.stringify(notifyModule)})
    const notifier = createNotifier({
      info: async () => ({ isChild: false, title: "$(not-a-shell-command)" }),
      elapsed: async () => null, permissionPending: async () => true,
    }, "project", "terminal")
    await notifier.notify("question", "ses_click")
    if ((await import("node:fs")).existsSync(${JSON.stringify(output)})) throw new Error("command ran before click")
    const request = daemon.requests[0]
    for (const action of ${JSON.stringify(scenario.actions)}) {
      if (!request) break
      if (action === "close") daemon.notifications.CloseNotification(request.id)
      else daemon.notifications.ActionInvoked(request.id, action)
      await Bun.sleep(20)
    }
    await Bun.sleep(250)
    console.log(JSON.stringify(request?.actions ?? []))
    notifier.dispose()
    disposeLinuxNotifications()
    daemon.stopDaemon()
  `
  const child = Bun.spawn(["dbus-run-session", "--", process.execPath, "--eval", script], {
    env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`,
      OPENCODE_NOTIFIER_CONFIG_PATH: configPath, KDE_SESSION_VERSION: "", XDG_CURRENT_DESKTOP: "", DESKTOP_SESSION: "" },
    stdout: "pipe", stderr: "pipe",
  })
  const stdout = await new Response(child.stdout).text()
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  expect(existsSync(output)).toBe(scenario.runs)
  if (scenario.runs) expect(readFileSync(output, "utf8").trim().split("\n").map(line => JSON.parse(line))).toEqual([["question", "ses_click", "$(not-a-shell-command)"]])
  expect(JSON.parse(stdout.trim()).includes("Run command")).toBe(scenario.enabled)
})
