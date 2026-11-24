import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { undefinedValue } from "./shared/runtime-values.ts"

// Verifies the committed golden vectors against their recorded hashes.
//
// The golden-vector check must compare the Rust implementation against the
// Vectors that are committed, not against vectors regenerated in the same
// Job. Regenerating first means the comparison always passes: a change to
// The TypeScript implementation is written into the file, and the Rust code
// Then agrees with the new file. This check fails when a committed vector
// Does not match its recorded hash, so the comparison input is immutable.
//
// It also fails when a vector file is missing, or when a file exists that
// The manifest does not cover, so the manifest cannot be quietly narrowed.
//
// Usage: bun run src/scripts/verify-golden-hashes.ts

const root = path.resolve(import.meta.dirname, "..", "..")
const goldenDir = path.join(root, "golden")
const MANIFEST = path.join(goldenDir, "SHA256SUMS")

const fail = (message: string): boolean => {
  console.error(`GOLDEN HASH VERIFICATION FAILED: ${message}`)
  process.exitCode = 1
  return true
}

const verify = (): void => {
  const recorded = new Map<string, string>()
  for (const line of fs.readFileSync(MANIFEST, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      const match = /^(?<hash>[0-9a-f]{64})\s+(?<path>.+)$/u.exec(trimmed)
      let hash: string | undefined = undefinedValue
      let file: string | undefined = undefinedValue
      if (match && match.groups) {
        const { hash: parsedHash, path: parsedFile } = match.groups
        hash = parsedHash
        file = parsedFile
      }
      if (hash === undefinedValue || file === undefinedValue) {
        fail(`unreadable manifest line: "${trimmed}"`)
        return
      }
      recorded.set(file, hash)
    }
  }
  if (recorded.size === 0 && fail("the manifest records no vectors")) {
    return
  }

  const present = fs
    .readdirSync(goldenDir)
    .filter((name) => name.endsWith(".txt"))
    .toSorted()

  const unrecorded = present.filter((name) => !recorded.has(name))
  if (
    unrecorded.length > 0 &&
    fail(
      `${unrecorded.length} vector file(s) are not covered by the manifest: ${unrecorded.join(", ")}`,
    )
  ) {
    return
  }

  let checked = 0
  for (const [name, expected] of recorded) {
    const filePath = path.join(goldenDir, name)
    if (fs.existsSync(filePath)) {
      const actual = createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex")
      if (
        actual !== expected &&
        fail(
          `${name} does not match its recorded hash\n  expected ${expected}\n  actual   ${actual}`,
        )
      ) {
        return
      }
      checked += 1
    } else if (fail(`missing vector file: ${name}`)) {
      return
    }
  }

  console.log(
    `GOLDEN HASHES VERIFIED: ${checked} committed vectors match their recorded hashes.`,
  )
}

if (fs.existsSync(MANIFEST)) {
  verify()
} else {
  fail(
    `missing ${path.relative(root, MANIFEST)} — run \`bun run src/scripts/hash-golden.ts\``,
  )
}
