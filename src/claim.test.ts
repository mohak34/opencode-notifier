import { afterAll, expect, spyOn, test } from "bun:test"
import { createHash } from "crypto"
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createDeliveryClaimer } from "./claim"

const fixture = mkdtempSync(join(tmpdir(), "notifier-claim-test-"))
afterAll(() => rmSync(fixture, { recursive: true, force: true }))

const MINUTE_MS = 60_000
const hash = (key: string) => createHash("sha256").update(key).digest("hex")
const directoryName = `opencode-notifier-${process.getuid?.() ?? "claims"}`
const posix = process.platform !== "win32"

// Each test gets an isolated temp root, separate from running sessions' markers.
// true permits delivery; false suppresses a duplicate alert.
function setup() {
  const tempRoot = mkdtempSync(join(fixture, "temp-"))
  return { tempRoot, dir: join(tempRoot, directoryName), claim: createDeliveryClaimer(tempRoot) }
}

function expiredFile(path: string): string {
  writeFileSync(path, "")
  utimesSync(path, new Date(0), new Date(0))
  return path
}

test("two terminals sharing a temp root deliver each event only once", () => {
  const { tempRoot, claim } = setup()
  const otherTerminalClaim = createDeliveryClaimer(tempRoot)
  expect(claim("event-1")).toBe(true)
  expect(otherTerminalClaim("event-1")).toBe(false)
  expect(claim("event-2")).toBe(true)
})

test("a missing temp root is created and still deduplicates", () => {
  const { tempRoot } = setup()
  const claim = createDeliveryClaimer(join(tempRoot, "missing", "nested"))
  expect(claim("event")).toBe(true)
  expect(claim("event")).toBe(false)
})

test("a file blocking the claim directory allows repeated deliveries", () => {
  const { dir, claim } = setup()
  writeFileSync(dir, "not a directory")
  expect(claim("event")).toBe(true)
  expect(claim("event")).toBe(true)
})

// Symlink creation on Windows can require privileges unavailable to the test runner.
test.skipIf(!posix)("a symlinked claim directory allows repeated deliveries without touching its target", () => {
  const { dir, claim } = setup()
  const target = mkdtempSync(join(fixture, "target-"))
  // Looks like an expired marker; following the symlink during cleanup would delete it.
  const sentinel = expiredFile(join(target, hash("sentinel")))
  symlinkSync(target, dir)

  expect(claim("event")).toBe(true)
  expect(claim("event")).toBe(true)
  expect(existsSync(sentinel)).toBe(true)
  expect(existsSync(join(target, hash("event")))).toBe(false)
})

test.skipIf(!posix)("a symlinked temp root still deduplicates through its real claim directory", () => {
  const { tempRoot, dir, claim } = setup()
  const linkedRoot = join(fixture, "linked-temp")
  symlinkSync(tempRoot, linkedRoot)

  expect(createDeliveryClaimer(linkedRoot)("event")).toBe(true)
  expect(claim("event")).toBe(false)
  expect(existsSync(join(dir, hash("event")))).toBe(true)
})

test.skipIf(!posix)("a claim directory others can write allows repeated deliveries without cleanup", () => {
  for (const mode of [0o770, 0o777]) {
    const { dir, claim } = setup()
    mkdirSync(dir)
    chmodSync(dir, mode)
    const stale = expiredFile(join(dir, hash("stale")))
    expect(claim("event")).toBe(true)
    expect(claim("event")).toBe(true)
    expect(existsSync(stale)).toBe(true)
    expect(existsSync(join(dir, hash("event")))).toBe(false)
  }
})

test.skipIf(!posix)("a claim directory owned by another user allows repeated deliveries", () => {
  const { tempRoot, claim } = setup()
  const realUid = process.getuid!()
  const getuid = spyOn(process, "getuid").mockReturnValue(realUid + 1)
  try {
    // Created by us under the other uid's name, so its owner differs from the faked uid.
    const dir = join(tempRoot, `opencode-notifier-${realUid + 1}`)
    mkdirSync(dir, { mode: 0o700 })
    const stale = expiredFile(join(dir, hash("stale")))
    expect(claim("event")).toBe(true)
    expect(claim("event")).toBe(true)
    expect(existsSync(stale)).toBe(true)
  } finally {
    getuid.mockRestore()
  }
})

test("a throwing debug logger still lets unusable storage deliver", () => {
  const { dir, claim } = setup()
  writeFileSync(dir, "not a directory")
  const oldDebug = process.env.OPENCODE_NOTIFIER_DEBUG
  process.env.OPENCODE_NOTIFIER_DEBUG = "1"
  const log = spyOn(console, "error").mockImplementation(() => {
    throw new Error("stderr closed")
  })
  try {
    expect(claim("event")).toBe(true)
    expect(claim("event")).toBe(true)
  } finally {
    log.mockRestore()
    if (oldDebug === undefined) delete process.env.OPENCODE_NOTIFIER_DEBUG
    else process.env.OPENCODE_NOTIFIER_DEBUG = oldDebug
  }
})

test.skipIf(!posix)("an existing private claim directory from an earlier release keeps deduplicating", () => {
  for (const mode of [0o700, 0o755]) {
    const { dir, claim } = setup()
    mkdirSync(dir)
    chmodSync(dir, mode)
    expect(claim("event")).toBe(true)
    expect(claim("event")).toBe(false)
  }
})

test("cleanup deletes expired markers but preserves recent markers, other names, and link targets", () => {
  const { dir, claim } = setup()
  const now = Date.now()
  expect(claim("seed", now)).toBe(true)
  const stale = expiredFile(join(dir, hash("stale")))
  const unrelated = expiredFile(join(dir, "unrelated"))
  const target = expiredFile(join(mkdtempSync(join(fixture, "target-")), "kept"))
  const link = join(dir, hash("symlink"))
  if (posix) {
    symlinkSync(target, link)
    lutimesSync(link, new Date(0), new Date(0))
  }

  // Past the ten-minute cleanup interval; the seed is still under the one-hour expiry.
  expect(claim("after-prune", now + 11 * MINUTE_MS)).toBe(true)
  expect(existsSync(stale)).toBe(false)
  expect(existsSync(unrelated)).toBe(true)
  expect(existsSync(join(dir, hash("seed")))).toBe(true)
  expect(existsSync(target)).toBe(true)
  if (posix) expect(() => lstatSync(link)).toThrow()
  expect(claim("stale", now + 11 * MINUTE_MS)).toBe(true)
})

test("cleanup waits more than ten minutes between scans", () => {
  const { dir, claim } = setup()
  const now = Date.now()
  expect(claim("seed", now)).toBe(true)
  // Added after the first scan, so only the throttle keeps it.
  const stale = expiredFile(join(dir, hash("stale")))

  expect(claim("at-interval", now + 10 * MINUTE_MS)).toBe(true)
  expect(existsSync(stale)).toBe(true)
  expect(claim("past-interval", now + 10 * MINUTE_MS + 1)).toBe(true)
  expect(existsSync(stale)).toBe(false)
})
