import fs from "node:fs"
import type { CIBenchmarkResult } from "./ci-result.ts"

const summaryPath = process.env.GITHUB_STEP_SUMMARY
const resultsPath = "dist/bench-ci-results.json"

const r = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as CIBenchmarkResult
const e = r.environment

let md = "## GenoID CI benchmark\n\n"
md += `**Environment:** ${e.runtime} ${e.bun ?? e.node} | ${e.platform}/${e.arch} | ${e.cpuModel} (${e.cpuCount} cpus) | ${e.totalMemoryMB} MB\n\n`
md += "| Algorithm | ops/sec | us/op |\n|---|---:|---:|\n"
for (const b of r.benchmarks) md += `| ${b.name} | ${b.opsPerSec} | ${b.usPerOp} |\n`
md += "\n| Algorithm | n | collisions | PASS |\n|---|---:|---:|---|\n"
for (const c of r.collisions)
  md += `| ${c.name} | ${c.n} | ${c.collisions} | ${c.collisions === 0 ? "PASS" : "FAIL"} |\n`

// Always keep a copy in dist/ so it can be inspected as an artifact.
fs.writeFileSync("dist/ci-summary.md", md)

if (summaryPath) {
  fs.appendFileSync(summaryPath, md)
  console.log(`Wrote job summary to ${summaryPath}`)
} else {
  console.log("GITHUB_STEP_SUMMARY not set; wrote dist/ci-summary.md only")
}
