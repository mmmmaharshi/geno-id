import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { runExport } from "./dieharder-common.ts"

// Local driver for the dieharder randomness battery. Replaces the old CI job:
// dieharder is installed on the host (not on every runner) and the results are
// written to a local markdown file instead of a CI artifact.
//
// NIST SP 800-22 (`scripts/nist-bridge.py`) already validates all 15 tests on
// ~1.22M-bit samples. dieharder is an independent battery from a different
// codebase/test family and (unlike NIST) tolerates the 100M-bit samples this
// exporter produces without rewinding the file. The full `-a` battery (~114
// sub-tests) needs far more data/runtime, so this runs a curated subset
// spanning the diehard/sts/rgb/dab families.

const root = path.resolve(import.meta.dirname, "..")
// 12.5 MB per flat generator
const TARGET_BITS = 100_000_000
const GENERATORS = ["v4", "rawv8", "genoid", "struct-dbkey"]
const TESTS = [0, 2, 4, 5, 7, 8, 10, 13, 15, 100, 102, 203, 249, 251, 254]

function checkDieharder(): void {
  const r = spawnSync("dieharder", ["--version"], { stdio: "pipe" })
  if (r.error || r.status !== 0) {
    console.error("dieharder not found. Install it on the host, then re-run:")
    console.error("  macOS:  brew install dieharder")
    console.error("  Linux:  sudo apt-get install -y dieharder")
    process.exit(1)
  }
}

async function ensureSamples(): Promise<void> {
  const missing = GENERATORS.some(
    (g) => !fs.existsSync(path.resolve(root, "dist", `${g}.dieharder.bin`)),
  )
  if (missing) {
    console.log("Exporting 100M-bit samples (missing .dieharder.bin)...")
    await runExport(TARGET_BITS)
  }
}

interface Result {
  name: string
  pval: string
  assess: string
}

function parseResult(out: string, fallbackName: string): Result {
  let best: Result | null = null
  for (const line of out.split("\n")) {
    const parts = line
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (parts.length >= 4) {
      const assess = parts.at(-1)!
      const pval = parts.at(-2)!
      const name = parts[0]
      if (/PASSED|FAILED|WEAK|REVERSED|SUCCESS/i.test(assess) && !Number.isNaN(Number(pval))) {
        best = { name, pval, assess }
      }
    }
  }
  return best ?? { name: fallbackName, pval: "n/a", assess: "ERROR" }
}

function runTest(gen: string, t: number): Result {
  const file = path.resolve(root, "dist", `${gen}.dieharder.bin`)
  const out = execFileSync(
    "dieharder",
    ["-d", String(t), "-g", "201", "-f", file],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] },
  )
  return parseResult(out, `test ${t}`)
}

async function main(): Promise<void> {
  checkDieharder()
  await ensureSamples()

  console.log(
    `Running dieharder curated subset (${(TARGET_BITS / 1e6).toFixed(0)}M bits/sample)...`,
  )

  let md = "## dieharder extended randomness battery\n\n"
  md += `12.5MB / 100M-bit sample per generator. Curated subset (not \`-a\`); see sources/reproducibility.md §3 for rationale.\n\n`
  md += "| Generator | Test | p-value | Assessment |\n|---|---|---:|---|\n"

  let failures = 0
  for (const g of GENERATORS) {
    for (const t of TESTS) {
      const r = runTest(g, t)
      if (/FAILED|REVERSED/i.test(r.assess)) failures++
      md += `| ${g} | ${r.name} | ${r.pval} | ${r.assess} |\n`
    }
  }

  const outPath = path.resolve(root, "dist", "dieharder-results.md")
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, md)
  console.log(md)
  console.log(`Wrote ${outPath}`)
  if (failures > 0) {
    console.error(`\n${failures} dieharder test(s) FAILED/REVERSED.`)
    process.exit(1)
  }
}

await main()
