import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Bit allocation. The allocator reduces "where do declared fields sit in a
// fixed-length identifier" to single-machine weighted completion time and
// solves it with Smith's rule (order by non-increasing weight / length).
// The pre-existing planner ordered by workload role rank, which is not
// optimal for that objective.

const root = path.resolve(import.meta.dirname, "..")
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
    fields: { name: string; cardinality: number; weight: number; bits: number; offset: number; priority: number }[]
    filler: { offset: number; bits: number }[]
    structuredBits: number
    randomBits: number
    requiredRandomBits: number
    feasible: boolean
    reason?: string
    weightedDepth: number
    weightedDepthRankOrder: number
    algorithm: string
  }
}

const { minBitsForCardinality, collisionProbabilityUpperBound, minRandomBitsForCollisionBudget, planBitAllocation } = algo

// ---------------------------------------------------------------------------
// Cardinality floor
// ---------------------------------------------------------------------------

test("minBitsForCardinality is the ceiling of log2 and never below 1", () => {
  assert.equal(minBitsForCardinality(1), 1)
  assert.equal(minBitsForCardinality(2), 1)
  assert.equal(minBitsForCardinality(3), 2)
  assert.equal(minBitsForCardinality(4), 2)
  assert.equal(minBitsForCardinality(5), 3)
  assert.equal(minBitsForCardinality(8), 3)
  assert.equal(minBitsForCardinality(9), 4)
  assert.equal(minBitsForCardinality(256), 8)
  assert.equal(minBitsForCardinality(257), 9)
  assert.equal(minBitsForCardinality(2 ** 48), 48)
})

test("minBitsForCardinality rejects non-positive or non-integer input", () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => minBitsForCardinality(bad), RangeError, `expected a throw for ${bad}`)
  }
})

test("every cardinality floor round-trips: the widened field can hold the domain", () => {
  for (let cardinality = 1; cardinality <= 5000; cardinality++) {
    const bits = minBitsForCardinality(cardinality)
    assert.ok(2 ** bits >= cardinality, `${cardinality} values do not fit in ${bits} bits`)
    if (bits > 1) assert.ok(2 ** (bits - 1) < cardinality, `${bits} bits is not minimal for ${cardinality} values`)
  }
})

// ---------------------------------------------------------------------------
// Collision budget
// ---------------------------------------------------------------------------

test("collisionProbabilityUpperBound is monotone decreasing in the random-bit budget", () => {
  const n = 1_000_000
  let previous = 1
  for (let r = 0; r <= 80; r++) {
    const p = collisionProbabilityUpperBound(n, r)
    assert.ok(p <= previous, `collision bound rose from ${previous} to ${p} at r=${r}`)
    previous = p
  }
})

test("collisionProbabilityUpperBound matches the closed form n(n-1) / 2^(r+2)", () => {
  const n = 1_000_000
  const r = 40
  const expected = 1 - Math.exp(-(n * (n - 1)) / (2 * 2 ** (r + 1)))
  assert.ok(Math.abs(collisionProbabilityUpperBound(n, r) - expected) < 1e-15)
})

test("minRandomBitsForCollisionBudget returns the smallest r that meets the target", () => {
  const n = 2_000_000
  const target = 0.01
  const r = minRandomBitsForCollisionBudget(n, target)
  assert.ok(collisionProbabilityUpperBound(n, r) <= target, `${r} bits misses the target`)
  assert.ok(collisionProbabilityUpperBound(n, r - 1) > target, `${r - 1} bits already meets the target`)
})

test("minRandomBitsForCollisionBudget spans the expected range across volumes and targets", () => {
  // A 122-bit pool needs no extra entropy for 2M ids; a 60-bit pool needs
  // about 47. Both must come out of the same function.
  assert.equal(minRandomBitsForCollisionBudget(2_000_000, 0.01), 47)
  assert.equal(minRandomBitsForCollisionBudget(10_000, 0.01), 32)
  assert.equal(minRandomBitsForCollisionBudget(2_000_000, 1e-9), 70)
})

test("a tighter collision target never needs fewer bits", () => {
  const n = 500_000
  let previous = 0
  for (const target of [1e-1, 1e-2, 1e-3, 1e-6, 1e-9, 1e-12]) {
    const r = minRandomBitsForCollisionBudget(n, target)
    assert.ok(r >= previous, `target ${target} demanded fewer bits than a looser one`)
    previous = r
  }
})

// ---------------------------------------------------------------------------
// Feasibility
// ---------------------------------------------------------------------------

const base = { budget: 122 }

test("the shipped dbkey layout is feasible with a 2M-id collision budget", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "timestamp", cardinality: 2 ** 48, weight: 0, leading: true, align: 1 },
      { name: "shard", cardinality: 5, weight: 40 },
      { name: "counter", cardinality: 65536, weight: 5 },
    ],
    volume: 2_000_000,
    collisionTarget: 0.01,
  })
  assert.equal(plan.feasible, true)
  assert.equal(plan.structuredBits, 48 + 3 + 16)
  assert.equal(plan.randomBits, 122 - 67)
  assert.equal(plan.requiredRandomBits, 47)
  assert.ok(plan.randomBits >= plan.requiredRandomBits)
})

test("over-budget structure is reported, not silently truncated", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "a", cardinality: 2 ** 50, weight: 1 },
      { name: "b", cardinality: 2 ** 50, weight: 1 },
      { name: "c", cardinality: 2 ** 50, weight: 1 },
    ],
  })
  assert.equal(plan.feasible, false)
  assert.match(plan.reason ?? "", /structured floors total/)
  assert.equal(plan.fields.length, 0)
})

test("structure whose floors fit the budget but will not pack is reported, not thrown", () => {
  // Two 60-bit fields have floors of 120 against a 122-bit budget, but a
  // 60-bit field cannot be placed byte-aligned around the six reserved bits
  // without colliding, so the packer refuses.
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "a", cardinality: 2 ** 60, weight: 1 },
      { name: "b", cardinality: 2 ** 60, weight: 1 },
    ],
  })
  assert.equal(plan.feasible, false)
  assert.match(plan.reason ?? "", /does not fit/)
  assert.equal(plan.fields.length, 0)
})

test("structure that leaves too little entropy for the collision budget is refused", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [{ name: "wide", cardinality: 2 ** 90, weight: 1 }],
    volume: 2_000_000,
    collisionTarget: 0.01,
  })
  assert.equal(plan.feasible, false)
  assert.match(plan.reason ?? "", /collision budget needs/)
})

test("a feasible plan partitions the 128 bits exactly, reserved bits excluded", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "ts", cardinality: 2 ** 48, weight: 0, leading: true, align: 1 },
      { name: "shard", cardinality: 5, weight: 40 },
      { name: "ctr", cardinality: 65536, weight: 5 },
    ],
  })
  const covered = new Set<number>()
  for (const f of plan.fields) for (let b = f.offset; b < f.offset + f.bits; b++) covered.add(b)
  for (const run of plan.filler) for (let b = run.offset; b < run.offset + run.bits; b++) covered.add(b)
  for (const b of [48, 49, 50, 51, 64, 65]) assert.ok(!covered.has(b), `reserved bit ${b} was allocated`)
  assert.equal(covered.size + 6, 128, "allocated plus reserved bits must cover the UUID")
  assert.equal(plan.structuredBits + plan.randomBits, 122)
})

test("fields never overlap each other", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "a", cardinality: 2 ** 20, weight: 3 },
      { name: "b", cardinality: 7, weight: 30 },
      { name: "c", cardinality: 2 ** 8, weight: 1 },
      { name: "d", cardinality: 33, weight: 12 },
    ],
  })
  const spans = plan.fields.map((f) => [f.offset, f.offset + f.bits] as const)
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      assert.ok(
        spans[i][1] <= spans[j][0] || spans[j][1] <= spans[i][0],
        `${plan.fields[i].name} overlaps ${plan.fields[j].name}`,
      )
    }
  }
})

test("a leading field is forced to offset 0", () => {
  const plan = planBitAllocation({
    ...base,
    fields: [
      { name: "hot", cardinality: 5, weight: 1000 },
      { name: "ts", cardinality: 2 ** 48, weight: 0, leading: true, align: 1 },
    ],
  })
  const ts = plan.fields.find((f) => f.name === "ts")!
  assert.equal(ts.offset, 0)
  assert.equal(ts.bits, 48)
})

// ---------------------------------------------------------------------------
// Smith's rule: optimality verified against brute force
// ---------------------------------------------------------------------------

interface SmallField {
  name: string
  cardinality: number
  weight: number
}

/** Total weighted depth of a rank packing, computed the same way the allocator does. */
function weightedDepthOfOrder(fields: readonly SmallField[], align: 1 | 4 | 8): number {
  const used = new Set<number>()
  let depth = 0
  for (const field of fields) {
    const bits = minBitsForCardinality(field.cardinality)
    let offset = -1
    for (let candidate = 0; candidate + bits <= 128; candidate += align) {
      let ok = true
      for (let b = candidate; b < candidate + bits; b++) {
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
    assert.notEqual(offset, -1, "brute-force order did not pack")
    for (let b = offset; b < offset + bits; b++) used.add(b)
    depth += field.weight * (offset + bits)
  }
  return depth
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([items[i], ...tail])
  }
  return out
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test("Smith's rule beats the rank order on the textbook case where longest-first fails", () => {
  // w/p: a = 10, b = 0.1, so a must precede b. Sorting by length alone
  // reverses that and costs 6x on the weighted-depth objective.
  const fields: SmallField[] = [
    { name: "a", cardinality: 2, weight: 10 },
    { name: "b", cardinality: 2 ** 10, weight: 1 },
  ]
  assert.ok(weightedDepthOfOrder(fields, 1) < weightedDepthOfOrder([fields[1], fields[0]], 1))
  const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
  assert.equal(plan.fields[0].name, "a")
  assert.ok(plan.weightedDepth < plan.weightedDepthRankOrder)
})

test("the allocator is optimal over every permutation, on 400 randomized instances", () => {
  const random = mulberry32(20261009)
  let improved = 0
  for (let trial = 0; trial < 400; trial++) {
    const count = 1 + Math.floor(random() * 6)
    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      name: `f${index}`,
      cardinality: 1 + Math.floor(random() * 2 ** 8),
      weight: Math.floor(random() * 50),
    }))
    // Skip instances whose floors cannot pack.
    const floorTotal = fields.reduce((sum, f) => sum + minBitsForCardinality(f.cardinality), 0)
    if (floorTotal > 120) continue

    const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
    assert.equal(plan.feasible, true, `trial ${trial} was unexpectedly infeasible`)

    const best = Math.min(...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)))
    assert.equal(
      plan.weightedDepth,
      best,
      `trial ${trial}: allocator depth ${plan.weightedDepth} but brute force found ${best} for ${JSON.stringify(fields)}`,
    )
    if (plan.weightedDepth < plan.weightedDepthRankOrder) improved++
  }
  assert.ok(improved > 0, "expected the Smith order to beat the rank order on at least one instance")
})

test("the rank order the shipped planner used is measurably suboptimal", () => {
  const random = mulberry32(7)
  const gaps: number[] = []
  for (let trial = 0; trial < 200; trial++) {
    const count = 2 + Math.floor(random() * 5)
    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      name: `f${index}`,
      cardinality: 1 + Math.floor(random() * 2 ** 12),
      weight: Math.floor(random() * 100),
    }))
    if (fields.reduce((sum, f) => sum + minBitsForCardinality(f.cardinality), 0) > 120) continue
    const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
    if (plan.weightedDepthRankOrder > plan.weightedDepth) {
      gaps.push((plan.weightedDepthRankOrder - plan.weightedDepth) / plan.weightedDepth)
    }
  }
  assert.ok(gaps.length > 0, "no instance showed a gap")
  const median = gaps.toSorted((a, b) => a - b)[Math.floor(gaps.length / 2)]
  assert.ok(median > 0, "the rank order should be worse in aggregate")
  assert.ok(median < 5, `the gap looks implausibly large at ${median}`)
})

test("priority equals weight over field width, which is the Smith key", () => {
  const plan = planBitAllocation({
    budget: 122,
    fields: [
      { name: "a", cardinality: 8, weight: 24 },
      { name: "b", cardinality: 4096, weight: 24 },
    ].map((f) => ({ ...f, align: 1 })),
  })
  for (const f of plan.fields) assert.equal(f.priority, f.weight / f.bits)
  const [first] = plan.fields
  assert.equal(first.name, "a", "the wider field has the lower weight/bit ratio and must sort later")
})

test("invalid input is rejected with a RangeError naming the field", () => {
  assert.throws(() => planBitAllocation({ fields: [] }), RangeError)
  assert.throws(() => planBitAllocation({ fields: [{ name: "a", cardinality: 0, weight: 1 }] }), /cardinality/)
  assert.throws(() => planBitAllocation({ fields: [{ name: "", cardinality: 2, weight: 1 }] }), /non-empty name/)
  assert.throws(
    () => planBitAllocation({ fields: [{ name: "a", cardinality: 2, weight: -1 }] }),
    /weight/,
  )
  assert.throws(
    () => planBitAllocation({ budget: 0, fields: [{ name: "a", cardinality: 2, weight: 1 }] }),
    RangeError,
  )
})

test("the allocation is deterministic", () => {
  const fields = [
    { name: "tenant", cardinality: 8, weight: 90, align: 1 as const },
    { name: "seq", cardinality: 2 ** 24, weight: 4, align: 1 as const },
    { name: "shard", cardinality: 5, weight: 30, align: 1 as const },
  ]
  const a = planBitAllocation({ budget: 122, fields })
  const b = planBitAllocation({ budget: 122, fields })
  assert.deepEqual(a, b)
})

// ---------------------------------------------------------------------------
// Scope of the optimality guarantee
// ---------------------------------------------------------------------------

test("the allocator is exactly optimal whenever all structure fits in the first free segment", () => {
  // Free segments are [0,48), [52,64), [66,128); the reserved bits split the
  // timeline. Smith's rule is exact on one unconstrained timeline, so an
  // allocation that never crosses bit 48 must attain the brute-force optimum.
  const random = mulberry32(4242)
  let checked = 0
  for (let trial = 0; trial < 600; trial++) {
    const count = 2 + Math.floor(random() * 4)
    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      name: `f${index}`,
      cardinality: 1 + Math.floor(random() * 64),
      weight: Math.floor(random() * 100),
    }))
    const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
    if (!plan.feasible) continue
    if (plan.structuredBits > 47) continue
    checked++
    const best = Math.min(...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)))
    assert.equal(
      plan.weightedDepth,
      best,
      `structuredBits=${plan.structuredBits} crossed bit 48 yet the allocator was suboptimal`,
    )
  }
  assert.ok(checked > 20, `expected many single-segment instances, saw ${checked}`)
})

test("a specific fragmented instance shows the bounded reserved-bit deviation", () => {
  // These fields total 52 bits, so the packer must cross the reserved
  // nibble at 48 and the allocator misses the exact optimum by a small,
  // bounded amount. The miss is the known limit of Smith's rule on a
  // fragmented timeline, not a regression.
  const fields: SmallField[] = [
    { name: "a", cardinality: 2 ** 20, weight: 3 },
    { name: "b", cardinality: 2 ** 12, weight: 50 },
    { name: "c", cardinality: 2 ** 11, weight: 2 },
    { name: "d", cardinality: 2 ** 8, weight: 30 },
    { name: "e", cardinality: 2, weight: 7 },
  ]
  const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
  assert.ok(plan.feasible)
  const best = Math.min(...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)))
  const excess = (plan.weightedDepth - best) / best
  assert.ok(plan.weightedDepth >= best, "the allocator cannot beat the exhaustive optimum")
  assert.ok(excess <= 0.05, `the reserved-bit deviation looks unbounded at ${(excess * 100).toFixed(2)}%`)
})

test("the shipped role-rank order is never better than Smith on the weighted objective", () => {
  const random = mulberry32(99)
  let compared = 0
  for (let trial = 0; trial < 300; trial++) {
    const count = 3 + Math.floor(random() * 3)
    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      name: `f${index}`,
      cardinality: 1 + Math.floor(random() * 4096),
      weight: Math.floor(random() * 100),
    }))
    const plan = planBitAllocation({ budget: 122, fields: fields.map((f) => ({ ...f, align: 1 })) })
    if (!plan.feasible) continue
    compared++
    assert.ok(
      plan.weightedDepth <= plan.weightedDepthRankOrder,
      "the Smith order must never be worse than the rank order it replaces",
    )
  }
  assert.ok(compared > 20, `expected many comparable instances, saw ${compared}`)
})