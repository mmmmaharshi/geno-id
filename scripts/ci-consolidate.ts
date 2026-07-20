// Consolidate every per-environment CI benchmark artifact into a single
// markdown table (+ JSON) so all results live in one place and can be copied
// in one go. Run by the `consolidate` CI job after the benchmark matrix.
//
// The benchmark matrix uploads `bench-ci-results.json` per job; this script
// scans the downloaded artifact directory for those files, merges them, and
// renders one wide table (one column per environment).

import fs from "node:fs"
import path from "node:path"
import type { BenchEntry, CIBenchmarkResult, CollisionEntry, EnvInfo } from "./ci-result.ts"

export function envLabel(e: EnvInfo): string {
  if (e.runtime === "deno") {
    const v = e.node.replace(/^deno-/, "")
    const osName = platformName(e.platform)
    return `Deno ${v} (${osName})`
  }
  if (e.runtime !== "bun") {
    const osName = platformName(e.platform)
    return `Node ${e.node.split(".")[0]} (${osName})`
  }
  let os = "Windows"
  if (e.platform === "linux") os = "Ubuntu"
  else if (e.platform === "darwin") os = "macOS"
  return `${os} (Bun)`
}

function platformName(platform: string): string {
  if (platform === "darwin") return "macOS"
  if (platform === "win32") return "Windows"
  return "Linux"
}

function platformRank(platform: string): number {
  if (platform === "linux") return 0
  if (platform === "darwin") return 1
  if (platform === "win32") return 2
  return 9
}

function rankEnv(e: EnvInfo): number {
  if (e.runtime === "deno") {
    return 20 + platformRank(e.platform)
  }
  if (e.runtime === "bun") {
    return { linux: 0, darwin: 1, win32: 2 }[e.platform] ?? 9
  }
  return 10 + (parseInt(e.node, 10) - 20) * 3 + platformRank(e.platform)
}

function mops(x: number): string {
  return `${(x / 1e6).toFixed(2)}M`
}

function collectFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(p))
    else if (entry.name === "bench-ci-results.json") out.push(p)
  }
  return out
}

export function renderConsolidated(results: CIBenchmarkResult[]): string {
  const sorted = [...results].toSorted(
    (a, b) => rankEnv(a.environment) - rankEnv(b.environment),
  )
  if (sorted.length === 0) {
    return "## GenoID CI benchmark — consolidated\n\n_No benchmark artifacts found._\n"
  }

  const cols = sorted.map((r) => envLabel(r.environment))
  const benchByName = new Map<string, BenchEntry[]>()
  for (const r of sorted) {
    for (const b of r.benchmarks) {
      if (!benchByName.has(b.name)) benchByName.set(b.name, [])
      benchByName.get(b.name)!.push(b)
    }
  }
  const collByName = new Map<string, CollisionEntry[]>()
  for (const r of sorted) {
    for (const c of r.collisions) {
      if (!collByName.has(c.name)) collByName.set(c.name, [])
      collByName.get(c.name)!.push(c)
    }
  }

  let md = "## GenoID CI benchmark — consolidated\n\n"
  md += `Merged from ${sorted.length} environment runs (mean of ${sorted[0].benchmarks[0]?.trials ?? "?"} repeated trials each).\n\n`

  // Throughput table
  md += `| Algorithm | ${cols.join(" | ")} |\n`
  md += `|---|${cols.map(() => "---:").join("|")}|\n`
  for (const [name, entries] of benchByName) {
    const cells = entries.map((b) => mops(b.opsPerSec))
    md += `| ${name} | ${cells.join(" | ")} |\n`
  }

  // Collision table
  md += "\n### Collisions (PASS = 0 collisions)\n\n"
  md += `| Algorithm | ${cols.join(" | ")} |\n`
  md += `|---|${cols.map(() => "---:").join("|")}|\n`
  for (const [name, entries] of collByName) {
    const cells = entries.map((c) => (c.collisions === 0 ? "PASS" : `${c.collisions}`))
    md += `| ${name} | ${cells.join(" | ")} |\n`
  }

  return md
}

function main(): void {
  const inputDir = process.argv[2] ?? "combined"

  fs.mkdirSync("dist", { recursive: true })

  const files = collectFiles(inputDir)
  const results = files.flatMap((f) => {
    try {
      return [JSON.parse(fs.readFileSync(f, "utf-8")) as CIBenchmarkResult]
    } catch {
      console.error(`Failed to parse ${f}, skipping`)
      return []
    }
  })

  const md = renderConsolidated(results)
  try {
    fs.writeFileSync("dist/all-results.json", JSON.stringify(results, null, 2))
    fs.writeFileSync("dist/all-summary.md", md)
  } catch (error) {
    console.error(`Failed to write consolidate output: ${(error as Error).message}`)
  }
  console.log(`Merged ${results.length} environment runs.`)
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.main) {
  main()
}
