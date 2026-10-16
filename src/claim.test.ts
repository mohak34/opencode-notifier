import { afterAll, expect, test } from "bun:test"
import { createHash } from "crypto"
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createDeliveryClaimer } from "./claim"

const fixture = mkdtempSync(join(tmpdir(), "notifier-claim-test-"))
afterAll(() => rmSync(fixture, { recursive: true, force: true }))

const MINUTE_MS = 60_000
const hash = (key: string) => createHash("sha256").update(key).digest("hex")
const directoryName = `opencode-notifier-${process.getuid?.() ?? "claims"}`

// Each test gets an isolated temp root, separate from running sessions' markers.
// true permits delivery; false suppresses a duplicate alert.
function setup() {
  const tempRoot = mkdtempSync(join(fixture, "temp-"))
  return { tempRoot, dir: join(tempRoot, directoryName), claim: createDeliveryClaimer(tempRoot) }
}

test("two terminals sharing a temp root deliver each event only once", () => {
  const { tempRoot, claim } = setup()
  const otherTerminalClaim = createDeliveryClaimer(tempRoot)
  expect(claim("event-1")).toBe(true)
  expect(otherTerminalClaim("event-1")).toBe(false)
  expect(claim("event-2")).toBe(true)
})

test("four processes claiming the same event permit exactly one delivery", async () => {
  const { tempRoot } = setup()
  const script = `import { createDeliveryClaimer } from ${JSON.stringify(join(import.meta.dir, "claim.ts"))}; console.log(createDeliveryClaimer(${JSON.stringify(tempRoot)})("race"))`
  const children = Array.from({ length: 4 }, () => Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" }))
  const results = await Promise.all(children.map(async child => {
    const output = await new Response(child.stdout).text()
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0)
    return output.trim()
  }))
  expect(results.filter(value => value === "true")).toHaveLength(1)
  expect(results.filter(value => value === "false")).toHaveLength(3)
})

test("a file blocking the claim directory allows repeated deliveries", () => {
  const { dir, claim } = setup()
  writeFileSync(dir, "not a directory")
  expect(claim("event")).toBe(true)
  expect(claim("event")).toBe(true)
})

// Symlink creation on Windows can require privileges unavailable to the test runner.
test.skipIf(process.platform === "win32")("a symlinked claim directory allows repeated deliveries without deleting or creating target files", () => {
  const { dir, claim } = setup()
  const target = mkdtempSync(join(fixture, "target-"))
  const sentinel = join(target, hash("sentinel"))
  // This looks like an expired marker. Following the directory symlink during
  // cleanup would delete it even though it belongs to an unrelated directory.
  writeFileSync(sentinel, "")
  utimesSync(sentinel, new Date(0), new Date(0))
  symlinkSync(target, dir)

  expect(claim("event")).toBe(true)
  expect(claim("event")).toBe(true)
  expect(existsSync(sentinel)).toBe(true)
  expect(existsSync(join(target, hash("event")))).toBe(false)
  expect(lstatSync(dir).isSymbolicLink()).toBe(true)
})

test.skipIf(process.platform === "win32")("a symlinked temp root still deduplicates through its real claim directory", () => {
  const { tempRoot, dir, claim } = setup()
  const linkedRoot = join(fixture, "linked-temp")
  symlinkSync(tempRoot, linkedRoot)
  const linkedClaim = createDeliveryClaimer(linkedRoot)

  expect(linkedClaim("event")).toBe(true)
  expect(claim("event")).toBe(false)
  expect(existsSync(join(dir, hash("event")))).toBe(true)
})

test.skipIf(!process.getuid)("directory permissions do not disable deduplication", () => {
  const { tempRoot, dir, claim } = setup()
  mkdirSync(dir)
  // Only the direct directory's symlink status is checked, not mode bits on
  // that directory or its parents.
  chmodSync(tempRoot, 0o777)
  chmodSync(dir, 0o755)
  try {
    expect(claim("event")).toBe(true)
    expect(claim("event")).toBe(false)
  } finally {
    chmodSync(tempRoot, 0o700)
    chmodSync(dir, 0o700)
  }
})

test("nonempty files, directories, and links are not accepted as proof of an earlier delivery", () => {
  const { dir, claim } = setup()
  expect(claim("seed")).toBe(true)
  const nonempty = join(dir, hash("nonempty"))
  writeFileSync(nonempty, "keep")
  mkdirSync(join(dir, hash("directory")))
  const hard = join(dir, hash("hard"))
  writeFileSync(hard, "")
  linkSync(hard, join(dir, "hard-link"))
  expect(claim("nonempty")).toBe(true)
  expect(claim("directory")).toBe(true)
  expect(claim("hard")).toBe(true)
  if (process.platform !== "win32") {
    symlinkSync(nonempty, join(dir, hash("symlink")))
    expect(claim("symlink")).toBe(true)
  }
})

test("cleanup deletes expired markers but preserves recent markers and entries that are not valid markers", () => {
  const { dir, claim } = setup()
  const now = Date.now()
  expect(claim("seed", now)).toBe(true)
  const marker = (key: string, contents = "") => {
    const path = join(dir, hash(key))
    writeFileSync(path, contents)
    utimesSync(path, new Date(0), new Date(0))
    return path
  }
  const stale = marker("stale")
  // Give non-marker files and the directory expired timestamps so their type,
  // contents, link count, or name must prevent deletion.
  const nonempty = marker("nonempty", "keep")
  const hard = marker("hard")
  linkSync(hard, join(dir, "hard-link"))
  const unrelated = join(dir, "unrelated")
  writeFileSync(unrelated, "")
  utimesSync(unrelated, new Date(0), new Date(0))
  const directory = join(dir, hash("directory"))
  mkdirSync(directory)
  utimesSync(directory, new Date(0), new Date(0))
  const link = join(dir, hash("symlink"))
  if (process.platform !== "win32") symlinkSync(nonempty, link)
  // Advance past the ten-minute cleanup interval; the seed is still under
  // the one-hour expiry threshold and must survive.
  expect(claim("after-prune", now + 11 * MINUTE_MS)).toBe(true)
  expect(existsSync(stale)).toBe(false)
  for (const path of [nonempty, hard, unrelated, directory, join(dir, hash("seed"))]) {
    expect(existsSync(path), `cleanup must preserve ${path}`).toBe(true)
  }
  if (process.platform !== "win32") expect(lstatSync(link).isSymbolicLink()).toBe(true)
  expect(readFileSync(nonempty, "utf8")).toBe("keep")
  expect(claim("stale", now + 11 * MINUTE_MS)).toBe(true)
})

test("cleanup waits more than ten minutes between scans", () => {
  const { dir, claim } = setup()
  const now = Date.now()
  expect(claim("seed", now)).toBe(true)

  // Add an expired marker after the first scan so only the throttle keeps it.
  const stale = join(dir, hash("stale"))
  writeFileSync(stale, "")
  utimesSync(stale, new Date(0), new Date(0))

  expect(claim("at-interval", now + 10 * MINUTE_MS)).toBe(true)
  expect(existsSync(stale)).toBe(true)
  expect(claim("past-interval", now + 10 * MINUTE_MS + 1)).toBe(true)
  expect(existsSync(stale)).toBe(false)
})
