/// <reference types="node" />
import assert from "node:assert/strict"

import { mulberry32 } from "./shared/cli-utils.ts"

import { need } from "../shared/need.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { test } from "node:test"

// Bit allocation. The allocator reduces "where do declared fields sit in a

// Fixed-length identifier" to single-machine weighted completion time and

// Solves it with Smith's rule (order by non-increasing weight / length).

// The pre-existing planner ordered by workload role rank, which is not

// Optimal for that objective.

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist", "algo.js")).href
)) as {
  minBitsForCardinality: (c: number) => number

  collisionProbabilityUpperBound: (n: number, r: number) => number

  minRandomBitsForCollisionBudget: (n: number, t: number) => number

  planBitAllocation: (input: {
    readonly budget?: number

    readonly fields: readonly {
      readonly name: string

      readonly cardinality: number

      readonly weight: number

      readonly locality?: string

      readonly align?: 1 | 4 | 8

      readonly leading?: boolean
    }[]

    readonly volume?: number

    readonly collisionTarget?: number

    readonly minRandomBits?: number
  }) => {
    fields: {
      name: string
      cardinality: number
      weight: number
      bits: number
      offset: number
      priority: number
    }[]

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

const {
  minBitsForCardinality,
  collisionProbabilityUpperBound,
  minRandomBitsForCollisionBudget,
  planBitAllocation,
} = algo

const base = { budget: 122 }

type AllocationInput = Parameters<typeof planBitAllocation>[0]

const withBase = (overrides: Partial<AllocationInput>): AllocationInput =>
  Object.assign(
    Object.create(Object.prototype) as AllocationInput,
    base,
    overrides,
  )

const planWithBase = (
  overrides: Partial<AllocationInput>,
): ReturnType<typeof planBitAllocation> =>
  planBitAllocation(withBase(overrides))

// ---------------------------------------------------------------------------

// Cardinality floor

// ---------------------------------------------------------------------------

void test("minBitsForCardinality is the ceiling of log2 and never below 1", () => {
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

void test("minBitsForCardinality rejects non-positive or non-integer input", () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => minBitsForCardinality(bad),
      RangeError,
      `expected a throw for ${bad}`,
    )
  }
})

void test("every cardinality floor round-trips: the widened field can hold the domain", () => {
  for (let cardinality = 1; cardinality <= 5000; cardinality += 1) {
    const bits = minBitsForCardinality(cardinality)

    assert.ok(
      2 ** bits >= cardinality,
      `${cardinality} values do not fit in ${bits} bits`,
    )

    if (bits > 1) {
      assert.ok(
        2 ** (bits - 1) < cardinality,
        `${bits} bits is not minimal for ${cardinality} values`,
      )
    }
  }
})

// ---------------------------------------------------------------------------

// Collision budget

// ---------------------------------------------------------------------------

void test("collisionProbabilityUpperBound is monotone decreasing in the random-bit budget", () => {
  const n = 1_000_000

  let previous = 1

  for (let r = 0; r <= 80; r += 1) {
    const p = collisionProbabilityUpperBound(n, r)

    assert.ok(
      p <= previous,
      `collision bound rose from ${previous} to ${p} at r=${r}`,
    )

    previous = p
  }
})

void test("collisionProbabilityUpperBound matches the closed form n(n-1) / 2^(r+2)", () => {
  const n = 1_000_000

  const r = 40

  const expected = 1 - Math.exp(-(n * (n - 1)) / (2 * 2 ** (r + 1)))

  assert.ok(Math.abs(collisionProbabilityUpperBound(n, r) - expected) < 1e-15)
})

void test("minRandomBitsForCollisionBudget returns the smallest r that meets the target", () => {
  const n = 2_000_000

  const target = 0.01

  const r = minRandomBitsForCollisionBudget(n, target)

  assert.ok(
    collisionProbabilityUpperBound(n, r) <= target,
    `${r} bits misses the target`,
  )

  assert.ok(
    collisionProbabilityUpperBound(n, r - 1) > target,
    `${r - 1} bits already meets the target`,
  )
})

void test("minRandomBitsForCollisionBudget spans the expected range across volumes and targets", () => {
  // A 122-bit pool needs no extra entropy for 2M ids; a 60-bit pool needs

  // About 47. Both must come out of the same function.

  assert.equal(minRandomBitsForCollisionBudget(2_000_000, 0.01), 47)

  assert.equal(minRandomBitsForCollisionBudget(10_000, 0.01), 32)

  assert.equal(minRandomBitsForCollisionBudget(2_000_000, 1e-9), 70)
})

void test("a tighter collision target never needs fewer bits", () => {
  const n = 500_000

  let previous = 0

  for (const target of [1e-1, 1e-2, 1e-3, 1e-6, 1e-9, 1e-12]) {
    const r = minRandomBitsForCollisionBudget(n, target)

    assert.ok(
      r >= previous,
      `target ${target} demanded fewer bits than a looser one`,
    )

    previous = r
  }
})

// ---------------------------------------------------------------------------

// Feasibility

// ---------------------------------------------------------------------------

void test("the shipped dbkey layout is feasible with a 2M-id collision budget", () => {
  const plan = planWithBase({
    collisionTarget: 0.01,

    fields: [
      {
        align: 1,
        cardinality: 2 ** 48,
        leading: true,
        name: "timestamp",
        weight: 0,
      },

      { cardinality: 5, name: "shard", weight: 40 },

      { cardinality: 65_536, name: "counter", weight: 5 },
    ],

    volume: 2_000_000,
  })

  assert.equal(plan.feasible, true)

  assert.equal(plan.structuredBits, 48 + 3 + 16)

  assert.equal(plan.randomBits, 122 - 67)

  assert.equal(plan.requiredRandomBits, 47)

  assert.ok(plan.randomBits >= plan.requiredRandomBits)
})

void test("over-budget structure is reported, not silently truncated", () => {
  const plan = planWithBase({
    fields: [
      { cardinality: 2 ** 50, name: "a", weight: 1 },

      { cardinality: 2 ** 50, name: "b", weight: 1 },

      { cardinality: 2 ** 50, name: "c", weight: 1 },
    ],
  })

  assert.equal(plan.feasible, false)

  assert.match(plan.reason ?? "", /structured floors total/u)

  assert.equal(plan.fields.length, 0)
})

void test("structure whose floors fit the budget but will not pack is reported, not thrown", () => {
  // Two 60-bit fields have floors of 120 against a 122-bit budget, but a

  // 60-bit field cannot be placed byte-aligned around the six reserved bits

  // Without colliding, so the packer refuses.

  const plan = planWithBase({
    fields: [
      { cardinality: 2 ** 60, name: "a", weight: 1 },

      { cardinality: 2 ** 60, name: "b", weight: 1 },
    ],
  })

  assert.equal(plan.feasible, false)

  assert.match(plan.reason ?? "", /does not fit/u)

  assert.equal(plan.fields.length, 0)
})

void test("structure that leaves too little entropy for the collision budget is refused", () => {
  const plan = planWithBase({
    collisionTarget: 0.01,

    fields: [{ cardinality: 2 ** 90, name: "wide", weight: 1 }],

    volume: 2_000_000,
  })

  assert.equal(plan.feasible, false)

  assert.match(plan.reason ?? "", /collision budget needs/u)
})

void test("a feasible plan partitions the 128 bits exactly, reserved bits excluded", () => {
  const plan = planWithBase({
    fields: [
      { align: 1, cardinality: 2 ** 48, leading: true, name: "ts", weight: 0 },

      { cardinality: 5, name: "shard", weight: 40 },

      { cardinality: 65_536, name: "ctr", weight: 5 },
    ],
  })

  const covered = new Set<number>()

  for (const f of plan.fields) {
    for (let b = f.offset; b < f.offset + f.bits; b += 1) {
      covered.add(b)
    }
  }

  for (const run of plan.filler) {
    for (let b = run.offset; b < run.offset + run.bits; b += 1) {
      covered.add(b)
    }
  }

  for (const b of [48, 49, 50, 51, 64, 65]) {
    assert.ok(!covered.has(b), `reserved bit ${b} was allocated`)
  }

  assert.equal(
    covered.size + 6,
    128,
    "allocated plus reserved bits must cover the UUID",
  )

  assert.equal(plan.structuredBits + plan.randomBits, 122)
})

void test("fields never overlap each other", () => {
  const plan = planWithBase({
    fields: [
      { cardinality: 2 ** 20, name: "a", weight: 3 },

      { cardinality: 7, name: "b", weight: 30 },

      { cardinality: 2 ** 8, name: "c", weight: 1 },

      { cardinality: 33, name: "d", weight: 12 },
    ],
  })

  const spans = plan.fields.map((f) => [f.offset, f.offset + f.bits] as const)

  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      assert.ok(
        spans[i][1] <= spans[j][0] || spans[j][1] <= spans[i][0],

        `${plan.fields[i].name} overlaps ${plan.fields[j].name}`,
      )
    }
  }
})

void test("a leading field is forced to offset 0", () => {
  const plan = planWithBase({
    fields: [
      { cardinality: 5, name: "hot", weight: 1000 },

      { align: 1, cardinality: 2 ** 48, leading: true, name: "ts", weight: 0 },
    ],
  })

  const ts = need(plan.fields.find((f) => f.name === "ts"))

  assert.equal(ts.offset, 0)

  assert.equal(ts.bits, 48)
})

// ---------------------------------------------------------------------------

// Smith's rule: optimality verified against brute force

// ---------------------------------------------------------------------------

interface SmallField {
  readonly name: string

  readonly cardinality: number

  readonly weight: number
}

/**
 * Total weighted depth of a rank packing, computed the same way the allocator does.
 * @param {readonly SmallField[]} fields Fields in rank order.
 * @param {1 | 4 | 8} align Required bit alignment.
 * @returns {number} Total weighted depth of the packed fields.
 */

const weightedDepthOfOrder = (
  fields: readonly SmallField[],
  align: 1 | 4 | 8,
): number => {
  const used = new Set<number>()

  let depth = 0

  for (const field of fields) {
    const bits = minBitsForCardinality(field.cardinality)

    let offset = -1

    for (let candidate = 0; candidate + bits <= 128; candidate += align) {
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

    assert.notEqual(offset, -1, "brute-force order did not pack")

    for (let b = offset; b < offset + bits; b += 1) {
      used.add(b)
    }

    depth += field.weight * (offset + bits)
  }

  return depth
}

const permutations = <T>(items: readonly T[]): T[][] => {
  if (items.length <= 1) {
    return [[...items]]
  }

  const out: T[][] = []

  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]

    for (const tail of permutations(rest)) {
      out.push([items[i], ...tail])
    }
  }

  return out
}

const alignField = (field: SmallField): SmallField & { align: 1 } =>
  Object.assign(
    Object.create(Object.prototype) as SmallField & { align: 1 },
    field,
    { align: 1 },
  )

void test("Smith's rule beats the rank order on the textbook case where longest-first fails", () => {
  // W/p: a = 10, b = 0.1, so a must precede b. Sorting by length alone

  // Reverses that and costs 6x on the weighted-depth objective.

  const fields: SmallField[] = [
    { cardinality: 2, name: "a", weight: 10 },

    { cardinality: 2 ** 10, name: "b", weight: 1 },
  ]

  assert.ok(
    weightedDepthOfOrder(fields, 1) <
      weightedDepthOfOrder([fields[1], fields[0]], 1),
  )

  const plan = planBitAllocation({
    budget: 122,
    fields: fields.map((f) => alignField(f)),
  })

  assert.equal(plan.fields[0].name, "a")

  assert.ok(plan.weightedDepth < plan.weightedDepthRankOrder)
})

void test("the allocator is optimal over every permutation, on 400 randomized instances", () => {
  const random = mulberry32(20_261_009)

  let improved = 0

  for (let trial = 0; trial < 400; trial += 1) {
    const count = 1 + Math.floor(random() * 6)

    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      cardinality: 1 + Math.floor(random() * 2 ** 8),

      name: `f${index}`,

      weight: Math.floor(random() * 50),
    }))

    // Skip instances whose floors cannot pack.

    const floorTotal = fields.reduce(
      (sum, f) => sum + minBitsForCardinality(f.cardinality),
      0,
    )

    if (floorTotal <= 120) {
      const plan = planBitAllocation({
        budget: 122,
        fields: fields.map((f) => alignField(f)),
      })

      assert.equal(
        plan.feasible,
        true,
        `trial ${trial} was unexpectedly infeasible`,
      )

      const best = Math.min(
        ...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)),
      )

      assert.equal(
        plan.weightedDepth,

        best,

        `trial ${trial}: allocator depth ${plan.weightedDepth} but brute force found ${best} for ${JSON.stringify(fields)}`,
      )

      if (plan.weightedDepth < plan.weightedDepthRankOrder) {
        improved += 1
      }
    }
  }

  assert.ok(
    improved > 0,
    "expected the Smith order to beat the rank order on at least one instance",
  )
})

void test("invalid input is rejected with a RangeError naming the field", () => {
  assert.throws(() => planBitAllocation({ fields: [] }), RangeError)

  assert.throws(
    () =>
      planBitAllocation({ fields: [{ cardinality: 0, name: "a", weight: 1 }] }),
    /cardinality/u,
  )

  assert.throws(
    () =>
      planBitAllocation({ fields: [{ cardinality: 2, name: "", weight: 1 }] }),
    /non-empty name/u,
  )

  assert.throws(
    () =>
      planBitAllocation({
        fields: [{ cardinality: 2, name: "a", weight: -1 }],
      }),

    /weight/u,
  )

  assert.throws(
    () =>
      planBitAllocation({
        budget: 0,
        fields: [{ cardinality: 2, name: "a", weight: 1 }],
      }),

    RangeError,
  )
})

void test("the allocation is deterministic", () => {
  const fields = [
    { align: 1 as const, cardinality: 8, name: "tenant", weight: 90 },

    { align: 1 as const, cardinality: 2 ** 24, name: "seq", weight: 4 },

    { align: 1 as const, cardinality: 5, name: "shard", weight: 30 },
  ]

  const a = planBitAllocation({ budget: 122, fields })

  const b = planBitAllocation({ budget: 122, fields })

  assert.deepEqual(a, b)
})

// ---------------------------------------------------------------------------

// Scope of the optimality guarantee

// ---------------------------------------------------------------------------

void test("the allocator is exactly optimal whenever all structure fits in the first free segment", () => {
  // Free segments are [0,48), [52,64), [66,128); the reserved bits split the

  // Timeline. Smith's rule is exact on one unconstrained timeline, so an

  // Allocation that never crosses bit 48 must attain the brute-force optimum.

  const random = mulberry32(4242)

  let checked = 0

  for (let trial = 0; trial < 600; trial += 1) {
    const count = 2 + Math.floor(random() * 4)

    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      cardinality: 1 + Math.floor(random() * 64),

      name: `f${index}`,

      weight: Math.floor(random() * 100),
    }))

    const plan = planBitAllocation({
      budget: 122,
      fields: fields.map((f) => alignField(f)),
    })

    if (plan.feasible && plan.structuredBits <= 47) {
      checked += 1

      const best = Math.min(
        ...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)),
      )

      assert.equal(
        plan.weightedDepth,

        best,

        `structuredBits=${plan.structuredBits} crossed bit 48 yet the allocator was suboptimal`,
      )
    }
  }

  assert.ok(
    checked > 20,
    `expected many single-segment instances, saw ${checked}`,
  )
})

void test("a specific fragmented instance shows the bounded reserved-bit deviation", () => {
  // These fields total 52 bits, so the packer must cross the reserved

  // Nibble at 48 and the allocator misses the exact optimum by a small,

  // Bounded amount. The miss is the known limit of Smith's rule on a

  // Fragmented timeline, not a regression.

  const fields: SmallField[] = [
    { cardinality: 2 ** 20, name: "a", weight: 3 },

    { cardinality: 2 ** 12, name: "b", weight: 50 },

    { cardinality: 2 ** 11, name: "c", weight: 2 },

    { cardinality: 2 ** 8, name: "d", weight: 30 },

    { cardinality: 2, name: "e", weight: 7 },
  ]

  const plan = planBitAllocation({
    budget: 122,
    fields: fields.map((f) => alignField(f)),
  })

  assert.ok(plan.feasible)

  const best = Math.min(
    ...permutations(fields).map((order) => weightedDepthOfOrder(order, 1)),
  )

  const excess = (plan.weightedDepth - best) / best

  assert.ok(
    plan.weightedDepth >= best,
    "the allocator cannot beat the exhaustive optimum",
  )

  assert.ok(
    excess <= 0.05,
    `the reserved-bit deviation looks unbounded at ${(excess * 100).toFixed(2)}%`,
  )
})

void test("the shipped role-rank order is never better than Smith on the weighted objective", () => {
  const random = mulberry32(99)

  let compared = 0

  for (let trial = 0; trial < 300; trial += 1) {
    const count = 3 + Math.floor(random() * 3)

    const fields: SmallField[] = Array.from({ length: count }, (_, index) => ({
      cardinality: 1 + Math.floor(random() * 4096),

      name: `f${index}`,

      weight: Math.floor(random() * 100),
    }))

    const plan = planBitAllocation({
      budget: 122,
      fields: fields.map((f) => alignField(f)),
    })

    if (plan.feasible) {
      compared += 1

      assert.ok(
        plan.weightedDepth <= plan.weightedDepthRankOrder,

        "the Smith order must never be worse than the rank order it replaces",
      )
    }
  }

  assert.ok(
    compared > 20,
    `expected many comparable instances, saw ${compared}`,
  )
})
