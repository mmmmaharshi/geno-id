import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { countVerdicts, parsePractrandOutput } from "./practrand-core.ts"

// Local driver for the PractRand randomness battery. PractRand is installed
// on the host (not in CI) and its output is written to a local file.
//
// PractRand reads raw random bytes, so the sample is the packed bit stream
// the same exporter produces for dieharder (`dieharder-common.ts`): the
// random-field bits of each UUID, packed into a byte buffer rather than an
// ASCII "0"/"1" string.
//
// Usage: bun run scripts/run-practrand.ts [--bits N] [--tlmax N]

const root = path.resolve(import.meta.dirname, "..")
const OUT = path.resolve(root, "results", "statistics", "practrand.txt")

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`))
  if (!hit) return fallback
  const n = Number(hit.slice(name.length + 3))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// Sample size, and the total number of bits PractRand is allowed to consume.
// PractRand's own test-length growth means a larger tlmax runs more tests.
const TARGET_BITS = arg("bits", 100_000_000)
const TL_MAX = arg("tlmax", 100_000_000)

const GENERATORS = ["v4", "rawv8", "genoid", "struct-dbkey"]

function checkPractrand(): void {
  const found = (() => {
    try {
      const probe = execFileSync(
        process.platform === "win32" ? "where" : "which",
        ["practrand"],
        { stdio: "pipe" },
      )
      return probe.toString().trim().length > 0
    } catch {
      return false
    }
  })()
  if (!found) {
    console.error("practrand not found. Install it on the host, then re-run:")
    console.error("  build from source: https://www.practrand.com/ (the repo has no binary release)")
    process.exit(1)
  }
}

function sampleFile(gen: string): string {
  return path.resolve(root, "dist", `${gen}.dieharder.bin`)
}

async function ensureSamples(): Promise<void> {
  const missing = GENERATORS.filter((g) => !fs.existsSync(sampleFile(g)))
  if (missing.length === 0) return
  console.log(`Exporting ${missing.length} sample(s) at ${(TARGET_BITS / 1e6).toFixed(0)}M bits each...`)
  const { runExport } = await import("./dieharder-common.ts")
  await runExport(TARGET_BITS)
}

function runOne(gen: string): string {
  const file = sampleFile(gen)
  // `-tl` sets the test length in bits; `-tlmax` caps the total bits read.
  return execFileSync(
    "practrand",
    ["-tl", "32", "-tlmax", String(TL_MAX), file],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  )
}

async function main(): Promise<void> {
  checkPractrand()
  await ensureSamples()

  let out = `## PractRand (${(TL_MAX / 1e6).toFixed(0)}M bit cap per generator)\n\n`
  out +=
    "Modern randomness suite run against the same packed random-field bit streams " +
    "as the dieharder battery. PractRand is installed on the host, not in CI.\n\n"
  out += "| Generator | Test | p-value | Assessed p-value | Verdict |\n|---|---|---:|---:|---|\n"

  let totalPassed = 0
  let totalFailed = 0
  let totalUnassessed = 0
  let emptyRuns = 0

  for (const gen of GENERATORS) {
    const rows = parsePractrandOutput(runOne(gen))
    if (rows.length === 0) {
      // A run whose output yields no rows means the tool's output did not
      // match the expected format. Counting that as a pass would be a false
      // clean result, so it is recorded as an empty run and fails the script.
      emptyRuns++
      out += `| ${gen} | (no parsable results) | — | — | UNPARSED |\n`
      continue
    }
    const counts = countVerdicts(rows)
    totalPassed += counts.passed
    totalFailed += counts.failed
    totalUnassessed += counts.unassessed
    for (const row of rows) {
      out += `| ${gen} | ${row.name} | ${row.p} | ${row.assessedP} | ${row.verdict ?? "—"} |\n`
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, out)
  console.log(`Wrote ${OUT}`)

  console.log(
    `\nSummary: ${totalPassed} passed, ${totalFailed} failed, ${totalUnassessed} unassessed, ${emptyRuns} unparsable run(s).`,
  )
  if (emptyRuns > 0) {
    console.error(
      `\n${emptyRuns} generator(s) produced no parsable PractRand results — check the practrand install and the output format.`,
    )
    process.exit(1)
  }
  if (totalFailed > 0) {
    console.error(`\n${totalFailed} PractRand test(s) reported an unusual result.`)
    process.exit(1)
  }
}

await main()
