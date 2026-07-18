import fs from "node:fs"

const summaryPath = process.env.GITHUB_STEP_SUMMARY
const resultsPath = "dist/bench-ci-results.json"

if (!summaryPath) {
  console.log("GITHUB_STEP_SUMMARY not set; skipping summary")
  process.exit(0)
}

interface Result {
  environment: {
    runtime: string
    bun: string | null
    node: string
    platform: string
    arch: string
    cpuModel: string
    cpuCount: number
    totalMemoryMB: number
  }
  benchmarks: { name: string; opsPerSec: number; usPerOp: number }[]
  collisions: { name: string; n: number; collisions: number }[]
}

const r = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as Result
const e = r.environment

let md = "## GenoID CI benchmark\n\n"
md += `**Environment:** ${e.runtime} ${e.bun ?? e.node} | ${e.platform}/${e.arch} | ${e.cpuModel} (${e.cpuCount} cpus) | ${e.totalMemoryMB} MB\n\n`
md += "| Algorithm | ops/sec | us/op |\n|---|---:|---:|\n"
for (const b of r.benchmarks) md += `| ${b.name} | ${b.opsPerSec} | ${b.usPerOp} |\n`
md += "\n| Algorithm | n | collisions | PASS |\n|---|---:|---:|---|\n"
for (const c of r.collisions)
  md += `| ${c.name} | ${c.n} | ${c.collisions} | ${c.collisions === 0 ? "PASS" : "FAIL"} |\n`

fs.appendFileSync(summaryPath, md)
console.log("Wrote job summary")
