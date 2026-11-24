import fs from "node:fs"

import type { CIBenchmarkResult } from "./ci-result.ts"
import { undefinedValue } from "./shared/runtime-values.ts"

const summaryPath = process.env.GITHUB_STEP_SUMMARY
const resultsPath = "dist/bench-ci-results.json"

const loadResults = (): CIBenchmarkResult | undefined => {
  try {
    return JSON.parse(fs.readFileSync(resultsPath, "utf8")) as CIBenchmarkResult
  } catch {
    console.error(`Failed to read or parse ${resultsPath}`)
    process.exitCode = 1
    return undefinedValue
  }
}

const main = (): void => {
  const r = loadResults()
  if (r === undefinedValue) {
    return
  }
  const e = r.environment

  let md = "## GenoID CI benchmark\n\n"
  md += `**Environment:** ${e.runtime} ${e.bun ?? e.node} | ${e.platform}/${e.arch} | ${e.cpuModel} (${e.cpuCount} cpus) | ${e.totalMemoryMB} MB\n\n`
  md +=
    "| Algorithm | ops/sec | us/op | CV | CI95[low] | CI95[high] |\n|---|---:|---:|---:|---:|---:|\n"
  for (const b of r.benchmarks) {
    md += `| ${b.name} | ${b.opsPerSec} | ${b.usPerOp} | ${b.cv} | ${b.ci95[0]} | ${b.ci95[1]} |\n`
  }

  if (r.comparisons && r.comparisons.length > 0) {
    md += "\n### Pairwise comparisons\n\n"
    md += "| Comparison | ratio | p | d | faster |\n|---|---:|---:|---:|:---|\n"
    for (const c of r.comparisons) {
      md += `| ${c.name} | ${c.ratio} | ${c.welchP} | ${c.cohensD} | ${c.faster} |\n`
    }
  }

  md += "\n| Algorithm | n | collisions | PASS |\n|---|---:|---:|---|\n"
  for (const c of r.collisions) {
    let status = "FAIL"
    if (c.collisions === 0) {
      status = "PASS"
    }
    md += `| ${c.name} | ${c.n} | ${c.collisions} | ${status} |\n`
  }

  // Always keep a copy in dist/ so it can be inspected as an artifact.
  try {
    fs.writeFileSync("dist/ci-summary.md", md)
  } catch (error) {
    console.error(
      `Failed to write dist/ci-summary.md: ${(error as Error).message}`
    )
  }

  if (typeof summaryPath === "string") {
    fs.appendFileSync(summaryPath, md)
    console.log(`Wrote job summary to ${summaryPath}`)
  } else {
    console.log("GITHUB_STEP_SUMMARY not set; wrote dist/ci-summary.md only")
  }
}

main()
