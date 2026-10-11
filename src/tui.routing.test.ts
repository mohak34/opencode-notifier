import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const root = mkdtempSync(join(tmpdir(), "notifier-routing-test-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

async function startClient(directory: string, name: string, openSessions: string[], options: { rootSession?: string, routeSession?: string, tabsEnabled?: boolean, focusOnClick?: boolean } = {}) {
  const configPath = join(directory, "config.json")
  writeFileSync(configPath, JSON.stringify({
    sound: false, bell: false, suppressWhenFocused: false,
    events: { client_connected: false }, command: { enabled: false },
    focusOnClick: options.focusOnClick ?? true,
  }))
  const module = (file: string) => JSON.stringify(join(import.meta.dir, file))
  const script = `
    const {mock} = await import("bun:test")
    const output = []
    let click
    mock.module(${module("focus.ts")}, () => ({
      captureStartupWindowId: async () => {}, isTerminalFocused: () => false,
      isTerminalJumpBackSupported: () => true, debugFocusState: () => {},
      focusTerminal: async () => output.push("jump:${name}"),
    }))
    mock.module(${module("notify.ts")}, () => ({
      sendNotification: async (...args) => {output.push("popup:${name}"); click = args[6]},
      disposeLinuxNotifications: () => {},
    }))
    const {default: plugin} = await import(${module("tui.ts")})
    let listener
    const tabs = ${JSON.stringify(openSessions)}
    const dispose = await plugin.setup({
      location: {directory:${JSON.stringify(directory)}},
      client: {session:{get:async ({sessionID}) => ({id:sessionID,title:"finished",location:{directory:${JSON.stringify(directory)}}})}},
      data: {listen(callback){listener=callback;return () => {}},session:{root(id){return ${JSON.stringify(options.rootSession)} ?? id}}},
      ui: {
        tabs: {enabled:()=>${options.tabsEnabled !== false},list:()=>tabs.map(sessionID=>({sessionID,active:false})),focus(id){if (!${options.tabsEnabled !== false}) return false; output.push("select:${name}:"+id);return true}},
        router: {current:()=>(${options.routeSession ? `{type:"session",sessionID:${JSON.stringify(options.routeSession)}}` : '{type:"home"}'}),navigate(route){output.push("navigate:${name}:"+route.sessionID)}},
      },
    })
    const {writeFileSync} = await import("fs")
    writeFileSync(${JSON.stringify(join(directory, name + ".ready"))}, "")
    await new Promise(resolve => process.stdin.once("data", resolve))
    listener({details:{id:"shared-completion",type:"session.execution.succeeded",location:{directory:${JSON.stringify(directory)}},data:{sessionID:"obsidian-session"}}})
    for (let attempt=0; attempt<60 && !click; attempt++) await Bun.sleep(10)
    click?.()
    await Bun.sleep(10)
    await dispose?.()
    console.log(JSON.stringify(output))
  `
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...process.env, OPENCODE_NOTIFIER_CONFIG_PATH: configPath, TMPDIR: directory },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  return child
}

test("a Ghostty client receiving completion first cannot claim an Obsidian-only session's popup or jump", async () => {
  const directory = mkdtempSync(join(root, "clients-"))
  const clients = await Promise.all([
    startClient(directory, "ghostty", ["ghostty-session"]),
    startClient(directory, "vscode", ["vscode-session"]),
    startClient(directory, "obsidian", ["obsidian-session"]),
  ])
  const outputs: string[] = []
  try {
    for (let attempt = 0; attempt < 100 && !["ghostty", "vscode", "obsidian"].every(name => existsSync(join(directory, name + ".ready"))); attempt++) await Bun.sleep(10)
    for (const child of clients) {
      child.stdin.write("complete\n")
      child.stdin.end()
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      expect(await child.exited, error).toBe(0)
      outputs.push(...JSON.parse(output))
    }
  } finally {
    for (const child of clients) if (child.exitCode === null) child.kill()
  }
  expect(outputs).toEqual(["popup:obsidian", "select:obsidian:obsidian-session", "jump:obsidian"])
})

test("without an open-session owner, a client still alerts and opens the completed session on click", async () => {
  const directory = mkdtempSync(join(root, "fallback-"))
  const child = await startClient(directory, "ghostty", ["other-session"])
  child.stdin.write("complete\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(JSON.parse(output)).toEqual(["popup:ghostty", "select:ghostty:obsidian-session", "jump:ghostty"])
})

test("a tabs-disabled client uses its current route to own a session and navigates on click", async () => {
  const directory = mkdtempSync(join(root, "route-"))
  const child = await startClient(directory, "obsidian", [], { tabsEnabled: false, routeSession: "obsidian-session" })
  child.stdin.write("complete\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(JSON.parse(output)).toEqual(["popup:obsidian", "navigate:obsidian:obsidian-session", "jump:obsidian"])
})

test("an open parent tab owns its child's event and the click selects the child in that family", async () => {
  const directory = mkdtempSync(join(root, "family-"))
  const child = await startClient(directory, "obsidian", ["parent-session"], { rootSession: "parent-session" })
  child.stdin.write("complete\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(JSON.parse(output)).toEqual(["popup:obsidian", "select:obsidian:parent-session", "navigate:obsidian:obsidian-session", "jump:obsidian"])
})

test("focusOnClick=false keeps the popup from changing tabs or focusing a window", async () => {
  const directory = mkdtempSync(join(root, "no-focus-"))
  const child = await startClient(directory, "obsidian", ["obsidian-session"], { focusOnClick: false })
  child.stdin.write("complete\n")
  child.stdin.end()
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(JSON.parse(output)).toEqual(["popup:obsidian"])
})
