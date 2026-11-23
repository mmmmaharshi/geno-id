import { writeFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { gitSha, mulberry32 } from "./shared/cli-utils.ts"

// Bit-allocation experiment (RQ-A).
//
// E-A1: the shipped role-rank order is not Smith-optimal. Measure the gap on
//       randomized workloads, and show brute force agrees with the allocator.
// E-A2: the entropy-locality frontier. For a fixed budget, how much weighted
//       depth must be paid for each bit of residual entropy retained?
// E-A3: the shipped dbkey layout's position on that frontier.

const root = path.resolve(import.meta.dirname, "..", "..")
const algo = (await import(pathToFileURL(path.resolve(root, "dist", "algo.js")).href)) as {
  minBitsForCardinality: (c: number) => number
  collisionProbabilityUpperBound: (n: number, r: number) => number
  minRandomBitsForCollisionBudget: (n: number, t: number) => number
  planBitAllocation: (input: {
    budget?: number
    fields: readonly {
      name: string
      cardinality: number
      weight: number
      locality?: string
      align?: 1 | 4 | 8
      leading?: boolean
    }[]
    volume?: number
    collisionTarget?: number
    minRandomBits?: number
  }) => {
    fields: { name: string; cardinality: number; weight: number; locality: string; bits: number; offset: number; priority: number }[]
    structuredBits: number
    randomBits: number
    weightedDepth: number
    weightedDepthRankOrder: number
    feasible: boolean
  }
}

const { minBitsForCardinality, collisionProbabilityUpperBound, minRandomBitsForCollisionBudget, planBitAllocation } = algo


interface Spec {
  name: string
  cardinality: number
  weight: number
}

function weightedDepthOfOrder(fields: readonly Spec[]): number {
  const used = new Set<number>()
  let depth = 0
  for (const field of fields) {
    const bits = minBitsForCardinality(field.cardinality)
    let offset = -1
    for (let candidate = 0; candidate + bits <= 128; candidate += 1) {
      let ok = true
      for (let b = candidate; b < candidate + bits; b += 1) {
        if ([48, 49, 50, 51, 64, 65].includes(b) || used.has(b)) {
          ok = false
          break
        }
      }
      if (ok) {
        offset = candidate
        break
      }
    }
    if (offset === -1) {return Number.POSITIVE_INFINITY}
    for (let b = offset; b < offset + bits; b += 1) {used.add(b)}
    depth += field.weight * (offset + bits)
  }
  return depth
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {return [[...items]]}
  const out: T[][] = []
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) {out.push([items[i], ...tail])}
  }
  return out
}

// ---------------------------------------------------------------------------
// E-A1: allocator optimality, and the gap against the shipped role-rank order
// ---------------------------------------------------------------------------

interface TrialRecord {
  instance: number
  fieldCount: number
  structuredBits: number
  smithDepth: number
  rankDepth: number
  bruteForceDepth: number
  smithIsOptimal: boolean
  gapVsRank: number
}

function runOptimalitySweep(trials: number, seed: number): {
  records: TrialRecord[]
  bruteForceAgreement: number
  rankWorseCount: number
  medianGapVsRank: number
  maxGapVsRank: number
  suboptimalCount: number
  suboptimalRelativeExcess: number[]
  suboptimalStructuredBitsRange: [number, number] | null
  agreementWithinFirstSegment: number
} {
  const random = mulberry32(seed)
  const records: TrialRecord[] = []
  for (let trial = 0; trial < trials; trial += 1) {
    const count = 2 + Math.floor(random() * 4)
    const fields: Spec[] = Array.from({ length: count }, (_, index) => ({
      cardinality: 1 + Math.floor(random() * 2 ** 12),
      name: `f${index}`,
      weight: Math.floor(random() * 100),
    }))
    if (fields.reduce((sum, f) => sum + minBitsForCardinality(f.cardinality), 0) > 118) {continue}

    const plan = planBitAllocation({
      budget: 122,
      fields: fields.map((f) => ({ ...f, align: 1 })),
    })
    if (!plan.feasible) {continue}
    const brute = Math.min(...permutations(fields).map((order) => weightedDepthOfOrder(order)))
    const gap = (plan.weightedDepthRankOrder - plan.weightedDepth) / plan.weightedDepth
    records.push({
      bruteForceDepth: brute,
      fieldCount: count,
      gapVsRank: Number(gap.toFixed(6)),
      instance: trial,
      rankDepth: plan.weightedDepthRankOrder,
      smithDepth: plan.weightedDepth,
      smithIsOptimal: plan.weightedDepth === brute,
      structuredBits: plan.structuredBits,
    })
  }
  const gaps = records.map((r) => r.gapVsRank).toSorted((a, b) => a - b)
  const suboptimal = records.filter((r) => !r.smithIsOptimal)
  return {
    agreementWithinFirstSegment:
      records.filter((r) => r.structuredBits <= 48 && r.smithIsOptimal).length /
      Math.max(1, records.filter((r) => r.structuredBits <= 48).length),
    bruteForceAgreement: records.filter((r) => r.smithIsOptimal).length / records.length,
    maxGapVsRank: gaps.at(-1) ?? 0,
    medianGapVsRank: gaps[Math.floor(gaps.length / 2)] ?? 0,
    rankWorseCount: records.filter((r) => r.gapVsRank > 0).length,
    records,
    suboptimalCount: suboptimal.length,
    suboptimalRelativeExcess: suboptimal.map((r) =>
      Number(((r.smithDepth - r.bruteForceDepth) / r.bruteForceDepth).toFixed(6)),
    ),
    suboptimalStructuredBitsRange:
      suboptimal.length === 0
        ? null
        : [
            Math.min(...suboptimal.map((r) => r.structuredBits)),
            Math.max(...suboptimal.map((r) => r.structuredBits)),
          ],
  }
}

// ---------------------------------------------------------------------------
// E-A2: the entropy-locality frontier
// ---------------------------------------------------------------------------

interface FrontierPoint {
  structuredBits: number
  randomBits: number
  weightedDepth: number
  collisionProbabilityAt2M: number
}

function runFrontier(): FrontierPoint[] {
  // One schema, progressively wider fields: each extra structural bit buys
  // capacity and costs residual entropy. Weighted depth is recomputed for
  // each point with the same relative weights, so only the field widths move.
  const points: FrontierPoint[] = []
  const weights = { node: 1, seq: 5, shard: 40, tenant: 90 }
  for (const extraTenant of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const tenantBits = 3 + extraTenant
    const fields = [
      { align: 1 as const, cardinality: 2 ** tenantBits, name: "tenant", weight: weights.tenant },
      { align: 1 as const, cardinality: 5, name: "shard", weight: weights.shard },
      { align: 1 as const, cardinality: 2 ** 24, name: "seq", weight: weights.seq },
      { align: 1 as const, cardinality: 2 ** 16, name: "node", weight: weights.node },
    ]
    const plan = planBitAllocation({ budget: 122, fields })
    if (!plan.feasible) {break}
    points.push({
      collisionProbabilityAt2M: Number(collisionProbabilityUpperBound(2_000_000, plan.randomBits).toExponential(3)),
      randomBits: plan.randomBits,
      structuredBits: plan.structuredBits,
      weightedDepth: Math.round(plan.weightedDepth),
    })
  }
  return points
}

// ---------------------------------------------------------------------------
// E-A3: where the shipped dbkey layout sits
// ---------------------------------------------------------------------------

function shippedDbkey(): Record<string, unknown> {
  const plan = planBitAllocation({
    budget: 122,
    fields: [
      { align: 1, cardinality: 2 ** 48, leading: true, name: "timestamp", weight: 0 },
      { align: 1, cardinality: 5, name: "shard", weight: 40 },
      { align: 1, cardinality: 2 ** 16, name: "counter", weight: 5 },
    ],
  })
  return {
    collisionProbabilityAt2M: collisionProbabilityUpperBound(2_000_000, plan.randomBits),
    depthHeadroomVsRankOrder: plan.weightedDepthRankOrder - plan.weightedDepth,
    fields: plan.fields.map((f) => ({ bits: f.bits, name: f.name, offset: f.offset, priority: Number(f.priority.toFixed(4)) })),
    randomBits: plan.randomBits,
    requiredRandomBitsFor2MAt1Percent: minRandomBitsForCollisionBudget(2_000_000, 0.01),
    structuredBits: plan.structuredBits,
    weightedDepth: plan.weightedDepth,
  }
}


const TRIALS = 500
const started = performance.now()
const optimality = runOptimalitySweep(TRIALS, 20_261_009)
const frontier = runFrontier()
const dbkey = shippedDbkey()
const elapsed = performance.now() - started

const report = {
  algorithm: "smith-rule",
  budgetBits: 122,
  description:
    "RQ-A: bit allocation in a fixed-length identifier as single-machine weighted completion time, solved by Smith's rule",
  e_a1_optimality: {
    agreementWithinFirstSegment: optimality.agreementWithinFirstSegment,
    bruteForceAgreement: optimality.bruteForceAgreement,
    instancesPacked: optimality.records.length,
    maxGapVsRankOrder: optimality.maxGapVsRank,
    medianGapVsRankOrder: optimality.medianGapVsRank,
    note:
      "smithDepth is compared against the exact optimum over every permutation of the same instance; bruteForceAgreement is the fraction of instances where the allocator attains it",
    perInstance: optimality.records,
    rankOrderWorseOn: optimality.rankWorseCount,
    suboptimalCount: optimality.suboptimalCount,
    suboptimalInstances: optimality.records
      .filter((r) => !r.smithIsOptimal)
      .map((r) => ({ bruteForceDepth: r.bruteForceDepth, instance: r.instance, smithDepth: r.smithDepth })),
    suboptimalRelativeExcess: optimality.suboptimalRelativeExcess,
    suboptimalStructuredBitsRange: optimality.suboptimalStructuredBitsRange,
    trialsRequested: TRIALS,
  },
  e_a2_entropy_locality_frontier: {
    note:
      "the tenant field is widened one bit at a time; structuredBits and randomBits sum to the 122-bit payload budget, and the collision probability is the exact upper bound for 2M ids at the residual width",
    points: frontier,
    widthAtWhichCollisionBudgetFails1Percent:
      frontier.find((p) => p.collisionProbabilityAt2M > 0.01)?.structuredBits ?? null,
    widthAtWhichCollisionBudgetFails50Percent:
      frontier.find((p) => p.collisionProbabilityAt2M > 0.5)?.structuredBits ?? null,
  },
  e_a3_shipped_dbkey: dbkey,
  elapsedMsTotal: Math.round(elapsed * 100) / 100,
  environment: {
    commitSha: gitSha(root),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    generatedAt: new Date().toISOString(),
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    runtime: `Bun ${(globalThis as { Bun?: { version: string } }).Bun?.version ?? process.version}`,
  },
  experiment: "bit-allocation",
  reservedBits: [48, 49, 50, 51, 64, 65],
}

mkdirSync(path.dirname(path.resolve(root, "results", "x")), { recursive: true })
writeFileSync(path.resolve(root, "results", "bit-allocation.json"), `${JSON.stringify(report, null, 2)}\n`)

console.log("\n=== E-A1: optimality vs brute force ===")
console.log(`instances: ${optimality.records.length}, brute-force agreement: ${(optimality.bruteForceAgreement * 100).toFixed(1)}%`)
console.log(`role-rank order worse on ${optimality.rankWorseCount} of ${optimality.records.length} instances, median gap ${(optimality.medianGapVsRank * 100).toFixed(2)}%, max ${(optimality.maxGapVsRank * 100).toFixed(2)}%`)
console.log("\n=== E-A2: entropy-locality frontier ===")
console.log(["structured", "random", "weightedDepth", "P(collision)@2M"].join("\t"))
for (const point of frontier) {
  console.log(
    [point.structuredBits, point.randomBits, point.weightedDepth, point.collisionProbabilityAt2M].join("\t"),
  )
}
console.log("\n=== E-A3: shipped dbkey layout ===")
console.log(JSON.stringify(dbkey, null, 1))
console.log(`\nwrote results/bit-allocation.json (${(report.elapsedMsTotal / 1000).toFixed(1)}s)`)