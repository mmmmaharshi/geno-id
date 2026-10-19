import path from "node:path"
import fs from "node:fs"
import { createHash } from "node:crypto"

// Verifies the committed golden vectors against their recorded hashes.
//
// The golden-vector check must compare the Rust implementation against the
// vectors that are committed, not against vectors regenerated in the same
// job. Regenerating first means the comparison always passes: a change to
// the TypeScript implementation is written into the file, and the Rust code
// then agrees with the new file. This check fails when a committed vector
// does not match its recorded hash, so the comparison input is immutable.
//
// It also fails when a vector file is missing, or when a file exists that
// the manifest does not cover, so the manifest cannot be quietly narrowed.
//
// Usage: bun run scripts/verify-golden-hashes.ts

const root = path.resolve(import.meta.dirname, "..")
const goldenDir = path.join(root, "golden")
const MANIFEST = path.join(goldenDir, "SHA256SUMS")

function fail(message: string): never {
  console.error(`GOLDEN HASH VERIFICATION FAILED: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(MANIFEST)) {
  fail(`missing ${path.relative(root, MANIFEST)} — run \`bun run scripts/hash-golden.ts\``)
}

const recorded = new Map<string, string>()
for (const line of fs.readFileSync(MANIFEST, "utf-8").split("\n")) {
  const trimmed = line.trim()
  if (trimmed.length === 0) continue
  const match = /^([0-9a-f]{64})\s+(.+)$/.exec(trimmed)
  if (!match) fail(`unreadable manifest line: "${trimmed}"`)
  recorded.set(match[2], match[1])
}
if (recorded.size === 0) fail("the manifest records no vectors")

const present = fs
  .readdirSync(goldenDir)
  .filter((name) => name.endsWith(".txt"))
  .toSorted()

const unrecorded = present.filter((name) => !recorded.has(name))
if (unrecorded.length > 0) {
  fail(`${unrecorded.length} vector file(s) are not covered by the manifest: ${unrecorded.join(", ")}`)
}

let checked = 0
for (const [name, expected] of recorded) {
  const filePath = path.join(goldenDir, name)
  if (!fs.existsSync(filePath)) fail(`missing vector file: ${name}`)
  const actual = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
  if (actual !== expected) {
    fail(`${name} does not match its recorded hash\n  expected ${expected}\n  actual   ${actual}`)
  }
  checked++
}

console.log(`GOLDEN HASHES VERIFIED: ${checked} committed vectors match their recorded hashes.`)
