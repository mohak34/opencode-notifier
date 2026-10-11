import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createTerminalClients } from "./terminal-clients"

const root = mkdtempSync(join(tmpdir(), "notifier-clients-test-"))
const previous = process.env.TMPDIR
afterAll(() => {
  if (previous === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = previous
  rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(root, "case-"))
  process.env.TMPDIR = directory
  const location = { directory: "/project" }
  const files = join(directory, `opencode-notifier-${process.getuid?.() ?? "claims"}`, "clients")
  return { directory, location, files }
}

test("only an open-session owner claims when another terminal receives the event first", async () => {
  const { location } = fixture()
  const other = createTerminalClients(() => ({ location, sessions: ["other"] }))
  const owner = createTerminalClients(() => ({ location, sessions: ["finished"] }))
  try {
    await Promise.all([other.refresh(), owner.refresh()])
    expect(await other.claim("complete", "finished")).toBe(false)
    expect(await owner.claim("complete", "finished")).toBe(true)
    expect(await owner.claim("complete", "finished")).toBe(false)
  } finally { other.dispose(); owner.dispose() }
})

test("presence refresh follows tab changes and child sessions resolve to their open root", async () => {
  const { location } = fixture()
  let sessions = ["parent"]
  const owner = createTerminalClients(() => ({ location, sessions }))
  const other = createTerminalClients(() => ({ location, sessions: [] }), () => "parent")
  try {
    await owner.refresh()
    expect(await other.claim("child-complete", "child")).toBe(false)
    sessions = []
    await owner.refresh()
    expect(await other.claim("child-complete", "child")).toBe(true)
  } finally { owner.dispose(); other.dispose() }
})

test("clients without UI state and a broken registry preserve fail-open alerts", async () => {
  const { directory, location } = fixture()
  const file = join(directory, "file")
  writeFileSync(file, "not a directory")
  process.env.TMPDIR = file
  const client = createTerminalClients(() => ({ location, sessions: null }))
  try {
    expect(await client.claim("question", "unknown")).toBe(true)
  } finally { client.dispose() }
})

test("another workspace cannot take ownership of this client's event", async () => {
  const { location } = fixture()
  const other = createTerminalClients(() => ({ location, sessions: [] }))
  const owner = createTerminalClients(() => ({ location: { ...location, workspaceID: "foreign" }, sessions: ["finished"] }))
  try {
    await owner.refresh()
    expect(await other.claim("complete", "finished")).toBe(true)
  } finally { other.dispose(); owner.dispose() }
})

for (const invalid of ["stale", "dead", "malformed"] as const) {
  test(`${invalid} presence cannot silence a completion`, async () => {
    const { location, files } = fixture()
    const owner = createTerminalClients(() => ({ location, sessions: ["finished"] }))
    const other = createTerminalClients(() => ({ location, sessions: [] }))
    try {
      await owner.refresh()
      const path = join(files, readdirSync(files).find(name => name.endsWith(".json"))!)
      const state = JSON.parse(readFileSync(path, "utf8"))
      if (invalid === "stale") state.updated = Date.now() - 10_000
      if (invalid === "dead") state.pid = 0
      writeFileSync(path, invalid === "malformed" ? "{" : JSON.stringify(state))
      expect(await other.claim("complete", "finished")).toBe(true)
    } finally { owner.dispose(); other.dispose() }
  })
}

test("disposal cancels an in-flight fallback instead of claiming or notifying later", async () => {
  const { location } = fixture()
  const client = createTerminalClients(() => ({ location, sessions: [] }))
  await client.refresh()
  const claim = client.claim("complete", "finished")
  client.dispose()
  expect(await claim).toBe(false)
})
