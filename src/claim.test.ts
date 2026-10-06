import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { claimDelivery } from "./claim"

const fixture = mkdtempSync(join(tmpdir(), "notifier-claim-test-"))
const oldTmpdir = process.env.TMPDIR
afterAll(() => {
  if (oldTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = oldTmpdir
  rmSync(fixture, { recursive: true, force: true })
})

test("only the first claim for a key delivers", () => {
  process.env.TMPDIR = fixture
  expect(claimDelivery("event-1")).toBe(true)
  expect(claimDelivery("event-1")).toBe(false)
  expect(claimDelivery("event-2")).toBe(true)
})

test("an unusable temp directory fails open", () => {
  const file = join(fixture, "not-a-directory")
  writeFileSync(file, "")
  process.env.TMPDIR = file
  expect(claimDelivery("event-1")).toBe(true)
  expect(claimDelivery("event-1")).toBe(true)
})
