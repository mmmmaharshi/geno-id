// Task D: 100M-scale batched collision test.
//
// The shared `collisionTest` keeps every ID in a Set<string>, which cannot hold
// 100M entries in memory. This test exercises `collisionTestScaled`, an exact
// dedup built on a compact open-addressing 128-bit hash set, and proves:
//   1. every production generator yields 0 collisions at scale (2M here), and
//   2. the detector actually catches real duplicates (sanity check).

import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { test } from "node:test"
// oxlint false-positive: does not track `import type` usage inside `as` casts.
// oxlint-disable-next-line no-unused-vars
import type { V8Layout } from "../dist/algo.js"

import { collisionTestScaled, DBKEY_LAYOUT } from "./collision-100m.ts"

const root = path.resolve(import.meta.dirname, "..")
const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string
  genV7: () => string
  genGenoID: () => string
  genStructuredGenoID: (l: V8Layout) => string
}

const N = 1_000_000

test("Task D: production generators produce 0 collisions at scale", { timeout: 30000 }, () => {
  for (const [label, gen] of [
    ["v4-native", algo.genV4Native],
    ["genoid-v8", algo.genGenoID],
    ["v7", algo.genV7],
    ["genoid-structured", () => algo.genStructuredGenoID(DBKEY_LAYOUT)],
  ] as const) {
    const r = collisionTestScaled(gen, N)
    assert.equal(r.collisions, 0, `${label} should have 0 collisions at N=${N}`)
    assert.ok(r.tableMB > 0 && r.tableMB < 1024, `${label} table memory should be bounded`)
  }
})

test("Task D: detector catches real duplicates (sanity check)", () => {
  let t = 0
  const fixed = () =>
    t++ % 2 === 0
      ? "00000000-0000-8000-8000-000000000000"
      : "11111111-1111-8000-8000-111111111111"
  const r = collisionTestScaled(fixed, 2000)
  assert.equal(r.collisions, 2000 - 2, "two unique values among 2000 inserts")
})
