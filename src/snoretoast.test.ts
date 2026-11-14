import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isExecutable, makeExecutable, snoreToastPath } from "./snoretoast"

const tempDirs: string[] = []

function tempFile(mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "notifier-snoretoast-"))
  tempDirs.push(dir)
  const file = join(dir, "snoretoast-x64.exe")
  writeFileSync(file, "")
  chmodSync(file, mode)
  return file
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("makeExecutable", () => {
  test("restores the execute bit on a file published as 0644", () => {
    const file = tempFile(0o644)
    expect(isExecutable(file)).toBe(false)

    expect(makeExecutable(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o755)
  })

  test("leaves an already executable file alone", () => {
    const file = tempFile(0o755)

    expect(makeExecutable(file)).toBe(true)
    expect(statSync(file).mode & 0o777).toBe(0o755)
  })

  test("returns false for a missing file instead of throwing", () => {
    expect(makeExecutable(join(tmpdir(), "notifier-missing-snoretoast.exe"))).toBe(false)
  })
})

describe("snoreToastPath", () => {
  test("selects the binary matching the architecture", () => {
    expect(snoreToastPath("x64")).toEndWith(join("vendor", "snoreToast", "snoretoast-x64.exe"))
    expect(snoreToastPath("arm64")).toEndWith(join("vendor", "snoreToast", "snoretoast-x86.exe"))
  })
})
