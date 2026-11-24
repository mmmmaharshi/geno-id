import { createHash } from "node:crypto"

import fs from "node:fs"

import path from "node:path"

// Hashes the committed golden vectors and writes the manifest.

//

// The golden-vector check must compare the Rust implementation against the

// Vectors that are committed, not against vectors regenerated in the same

// Job. Regenerating first means the comparison always passes: a change to

// The TypeScript implementation is written into the file, and the Rust code

// Then agrees with the new file. Hashing the committed vectors makes that

// Impossible — a changed implementation moves the hash, and the check fails

// Until the new vectors are committed deliberately.

//

// Usage: bun run src/scripts/hash-golden.ts

const root = path.resolve(import.meta.dirname, "..", "..")

const goldenDir = path.join(root, "golden")

const MANIFEST = path.join(goldenDir, "SHA256SUMS")

if (fs.existsSync(goldenDir)) {
  const files = fs

    .readdirSync(goldenDir)

    .filter((name) => name.endsWith(".txt"))

    .toSorted()

  if (files.length === 0) {
    console.error("no golden vector files to hash")

    process.exitCode = 1
  } else {
    const lines: string[] = []

    for (const name of files) {
      const bytes = fs.readFileSync(path.join(goldenDir, name))

      const digest = createHash("sha256").update(bytes).digest("hex")

      lines.push(`${digest}  ${name}`)
    }

    fs.writeFileSync(MANIFEST, `${lines.join("\n")}\n`)

    console.log(
      `Wrote ${path.relative(root, MANIFEST)} (${files.length} vectors)`,
    )
  }
} else {
  console.error(`missing ${path.relative(root, goldenDir)}`)

  process.exitCode = 1
}
