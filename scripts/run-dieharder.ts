import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { runExport } from "./dieharder-common.ts"

// Local driver for the dieharder randomness battery. dieharder is installed on
// the host (not in CI) and the results are written to a local markdown file.
//
// Runs the **curated diehard/STS subset** (`-d 0 2 4 5 7 8 10 13 15 100 102`)
// on a 12.5MB (100M-bit) sample. The 12.5MB sample is large enough that the
// diehard/STS sub-tests run WITHOUT rewinding the file (rewinding re-uses bits
// and invalidates p-values), so their p-values are trustworthy. The rgb/dab
// family (`rgb_lagged_sum`, `dab_bytedistrib`, `dab_monobit2`, …) rewinds the
// 12.5MB file dozens of times on its default sample request and is therefore
// excluded — see `sources/reproducibility.md` §3. The full dieharder `-a`
// battery (~114 sub-tests) needs a much larger sample and is out of scope;
// NIST SP 800-22 (`scripts/nist-bridge.py`) already covers all 15 tests.

const root = path.resolve(import.meta.dirname, "..")
// 12.5 MB per generator — large enough that the curated diehard/STS subset runs
// without rewinding the file.
const TARGET_BITS = 100_000_000
const GENERATORS = ["v4", "rawv8", "genoid", "struct-dbkey"]
// Curated subset: diehard + STS families, which run on the 12.5MB sample without
// rewinding. `runCurated` skips any ID absent in the installed build (portable
// across dieharder versions).
const CURATED_TESTS = [0, 2, 4, 5, 7, 8, 10, 13, 15, 100, 102]

function checkDieharder(): void {
  const r = spawnSync("which", ["dieharder"], { stdio: "pipe" })
  if (r.error || r.status !== 0 || !r.stdout?.toString().trim()) {
    console.error("dieharder not found. Install it on the host, then re-run:")
    console.error("  macOS:  build from source (removed from Homebrew) — see sources/reproducibility.md §3")
    console.error("  Linux:  sudo apt-get install -y dieharder")
    process.exit(1)
  }
}

function fileName(gen: string): string {
  return path.resolve(root, "dist", `${gen}.dieharder.bin`)
}

async function ensureSamples(): Promise<void> {
  const missing = GENERATORS.some((g) => !fs.existsSync(fileName(g)))
  if (missing) {
    console.log(`Exporting ${(TARGET_BITS / 1e6).toFixed(0)}M-bit samples (missing .dieharder.bin)...`)
    await runExport(TARGET_BITS)
  }
}

interface Result {
  name: string
  pval: string
  assess: string
}

const ASSESS_RE = /PASSED|FAILED|WEAK|REVERSED|SUCCESS/i

// Collect every assessment row from dieharder stdout. dieharder prints a header
// row (`test_name | ntup | tsamples | psamples | p-value | Assessment`) whose
// last column is "Assessment" and therefore does not match ASSESS_RE, so it is
// skipped. Some tests (e.g. opso, dna) emit multiple data rows — all are kept,
// which is why a single `-d N` invocation may yield more than one result.
function rowsFromOutput(out: string): Result[] {
  const rows: Result[] = []
  for (const line of out.split("\n")) {
    const parts = line.split("|").map((s) => s.trim()).filter((s) => s.length > 0)
    if (parts.length >= 4) {
      const assess = parts.at(-1)!
      const pval = parts.at(-2)!
      const name = parts[0]
      if (ASSESS_RE.test(assess) && !Number.isNaN(Number(pval))) {
        rows.push({ name, pval, assess })
      }
    }
  }
  return rows
}

function runCurated(gen: string): Result[] {
  const file = fileName(gen)
  const rows: Result[] = []
  for (const t of CURATED_TESTS) {
    let out: string
    try {
      out = execFileSync("dieharder", ["-d", String(t), "-g", "201", "-f", file], {
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch {
      // Test ID absent in this dieharder build, or the run errored.
      rows.push({ name: `test ${t}`, pval: "n/a", assess: "SKIPPED" })
      continue
    }
    const r = rowsFromOutput(out)
    if (r.length === 0) rows.push({ name: `test ${t}`, pval: "n/a", assess: "ERROR" })
    else rows.push(...r)
  }
  return rows
}

async function main(): Promise<void> {
  checkDieharder()
  await ensureSamples()

  console.log(`Running dieharder curated subset (${(TARGET_BITS / 1e6).toFixed(0)}M bits/sample)...`)

  const outPath = path.resolve(root, "dist", "dieharder-results.md")
  let md = "## dieharder curated subset\n\n"
  md += "12.5MB / 100M-bit sample per generator. Curated diehard + STS subset (no file rewind at this size); see sources/reproducibility.md §3.\n\n"
  md += "| Generator | Test | p-value | Assessment |\n|---|---|---:|---|\n"

  let passed = 0
  let weak = 0
  let failed = 0
  let errors = 0
  let anyError = false

  for (const g of GENERATORS) {
    const rows = runCurated(g)
    if (rows.length === 0) {
      anyError = true
      errors++
      md += `| ${g} | (no results — dieharder failed) | n/a | ERROR |\n`
      continue
    }
    for (const r of rows) {
      if (r.assess === "SKIPPED" || r.assess === "ERROR") errors++
      else if (/FAILED|REVERSED/i.test(r.assess)) failed++
      else if (/WEAK/i.test(r.assess)) weak++
      else passed++
      md += `| ${g} | ${r.name} | ${r.pval} | ${r.assess} |\n`
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, md)
  console.log(md)
  console.log(`Wrote ${outPath}`)

  const total = passed + weak + failed + errors
  console.log(
    `\nSummary: ${passed} PASSED, ${weak} WEAK, ${failed} FAILED, ${errors} ERROR/SKIPPED (${total} tests). ` +
      `WEAK/FAILED at this sample size are expected for dieharder's strictest sub-tests. ` +
      `The rgb/dab family is excluded because it rewinds the 12.5MB file (see §3).`,
  )
  if (anyError) {
    console.error(`\n${errors} generator(s) produced no dieharder results — check the dieharder install.`)
    process.exit(1)
  }
}

await main()
