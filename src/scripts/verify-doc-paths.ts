// Verifies that every repo-relative path cited in maintainer docs exists on
// disk. Docs rot silently on file moves (the src/ move orphaned ~40 refs);
// this turns that into a red build instead of a stale sentence.
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..", "..")
const files = [
  "paper.tex",
  "AGENTS.md",
  "README.md",
  "future.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/domain.md",
  "docs/agents/triage-labels.md",
  "docs/literature-review.md",
]

// Backticked or directive paths like `src/scripts/bench.ts`, results/*.json,
// golden/*.txt, .github/workflows/bench.yml. Skips URLs and bare words.
const PATTERN = /`((?:src|results|golden|docs|scripts|\.github)\/[^`\s]+?)`/g

let missing = 0
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf-8")
  const seen = new Set<string>()
  for (const m of text.matchAll(PATTERN)) {
    const ref = m[1].replace(/:\d+$/, "").replace(/[.,:;)]+$/, "")
    if (seen.has(ref) || ref.includes("*") || ref.endsWith("/")) continue
    seen.add(ref)
    const abs = path.join(root, ref)
    if (!fs.existsSync(abs)) {
      console.error(`missing: ${ref} (cited in ${rel})`)
      missing++
    }
  }
}
if (missing > 0) throw new Error(`${missing} cited path(s) do not exist`)
console.log("all cited paths exist")
