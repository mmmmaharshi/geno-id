import path from "node:path"
import fs from "node:fs"
import { createHash } from "node:crypto"

// Hashes the committed golden vectors and writes the manifest.
//
// The golden-vector check must compare the Rust implementation against the
// vectors that are committed, not against vectors regenerated in the same
// job. Regenerating first means the comparison always passes: a change to
// the TypeScript implementation is written into the file, and the Rust code
// then agrees with the new file. Hashing the committed vectors makes that
// impossible — a changed implementation moves the hash, and the check fails
// until the new vectors are committed deliberately.
//
// Usage: bun run scripts/hash-golden.ts

const root = path.resolve(import.meta.dirname, "..")
const goldenDir = path.join(root, "golden")
const MANIFEST = path.join(goldenDir, "SHA256SUMS")

if (!fs.existsSync(goldenDir)) {
  console.error(`missing ${path.relative(root, goldenDir)}`)
  process.exit(1)
}

const files = fs
  .readdirSync(goldenDir)
  .filter((name) => name.endsWith(".txt"))
  .toSorted()

if (files.length === 0) {
  console.error("no golden vector files to hash")
  process.exit(1)
}

const lines: string[] = []
for (const name of files) {
  const bytes = fs.readFileSync(path.join(goldenDir, name))
  const digest = createHash("sha256").update(bytes).digest("hex")
  lines.push(`${digest}  ${name}`)
}

fs.writeFileSync(MANIFEST, `${lines.join("\n")}\n`)
console.log(`Wrote ${path.relative(root, MANIFEST)} (${files.length} vectors)`)
