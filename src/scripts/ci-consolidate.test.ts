/// <reference types="node" />

import type { CIBenchmarkResult, EnvInfo } from "./ci-result.ts"

import { envLabel, renderConsolidated } from "./ci-consolidate.ts"

import assert from "node:assert/strict"

import { fromPartial } from "@total-typescript/shoehorn"

import { test } from "node:test"

const nullValue: null = JSON.parse("null") as null

const makeResult = (env: Partial<EnvInfo>, ops: number): CIBenchmarkResult => {
  const full: EnvInfo = Object.assign(
    Object.create(Object.prototype) as EnvInfo,
    {
      arch: "x64",

      bun: "1.3.0",

      cpuCount: 8,

      cpuModel: "test",

      node: "",

      platform: "linux",

      runtime: "bun",

      totalMemoryMB: 16_000,
    },
    env,
  )

  return {
    benchmarks: [
      {
        ci95: [ops, ops],
        cv: 0,
        name: "v4",
        opsPerSec: ops,
        samples: [ops],
        std: 0,
        trials: 10,
        usPerOp: 0,
      },
    ],

    collisions: [{ collisions: 0, n: 1_000_000, name: "v4" }],

    environment: full,
  }
}

void test("envLabel labels bun environments by OS", () => {
  assert.equal(
    envLabel(fromPartial({ bun: "1", platform: "linux", runtime: "bun" })),
    "Ubuntu (Bun)",
  )

  assert.equal(
    envLabel(fromPartial({ bun: "1", platform: "darwin", runtime: "bun" })),
    "macOS (Bun)",
  )

  assert.equal(
    envLabel(fromPartial({ bun: "1", platform: "win32", runtime: "bun" })),
    "Windows (Bun)",
  )
})

void test("envLabel labels deno environments distinctly", () => {
  assert.equal(
    envLabel(
      fromPartial({ node: "deno-2.9.3", platform: "linux", runtime: "deno" }),
    ),

    "Deno 2.9.3 (Linux)",
  )

  assert.equal(
    envLabel(
      fromPartial({ node: "deno-2.9.3", platform: "darwin", runtime: "deno" }),
    ),

    "Deno 2.9.3 (macOS)",
  )

  // Deno reports `windows` (not `win32` like Node/Bun) on Windows.

  assert.equal(
    envLabel(
      fromPartial({ node: "deno-2.9.3", platform: "windows", runtime: "deno" }),
    ),

    "Deno 2.9.3 (Windows)",
  )
})

void test("envLabel labels node environments by real OS, not hardcoded Linux", () => {
  assert.equal(
    envLabel(fromPartial({ node: "22", platform: "linux", runtime: "node" })),

    "Node 22 (Linux)",
  )

  assert.equal(
    envLabel(fromPartial({ node: "22", platform: "darwin", runtime: "node" })),

    "Node 22 (macOS)",
  )

  assert.equal(
    envLabel(fromPartial({ node: "22", platform: "win32", runtime: "node" })),

    "Node 22 (Windows)",
  )
})

void test("renderConsolidated renders a header and one column per environment", () => {
  const md = renderConsolidated([
    makeResult(
      { bun: nullValue, node: "22", platform: "linux", runtime: "node" },
      12_500_000,
    ),

    makeResult({ bun: "1", platform: "linux", runtime: "bun" }, 11_192_453),
  ])

  assert.match(md, /## GenoID CI benchmark — consolidated/u)

  assert.match(md, /Ubuntu \(Bun\)/u)

  assert.match(md, /Node 22 \(Linux\)/u)

  assert.match(md, /\| v4 \|/u)

  assert.match(md, /11\.19M/u)

  assert.match(md, /PASS/u)
})

void test("renderConsolidated orders columns bun-first then node by version", () => {
  const md = renderConsolidated([
    makeResult(
      { bun: nullValue, node: "23", platform: "linux", runtime: "node" },
      1,
    ),

    makeResult(
      { bun: nullValue, node: "20", platform: "linux", runtime: "node" },
      1,
    ),

    makeResult({ bun: "1", platform: "darwin", runtime: "bun" }, 1),

    makeResult({ bun: "1", platform: "linux", runtime: "bun" }, 1),
  ])

  const idxUbuntu = md.indexOf("Ubuntu (Bun)")

  const idxMacos = md.indexOf("macOS (Bun)")

  const idxNode20 = md.indexOf("Node 20 (Linux)")

  const idxNode23 = md.indexOf("Node 23 (Linux)")

  assert.ok(idxUbuntu < idxMacos)

  assert.ok(idxMacos < idxNode20)

  assert.ok(idxNode20 < idxNode23)
})

void test("renderConsolidated orders node columns by OS within a version", () => {
  const md = renderConsolidated([
    makeResult(
      { bun: nullValue, node: "22", platform: "win32", runtime: "node" },
      1,
    ),

    makeResult(
      { bun: nullValue, node: "22", platform: "darwin", runtime: "node" },
      1,
    ),

    makeResult(
      { bun: nullValue, node: "22", platform: "linux", runtime: "node" },
      1,
    ),
  ])

  const idxLinux = md.indexOf("Node 22 (Linux)")

  const idxMacos = md.indexOf("Node 22 (macOS)")

  const idxWindows = md.indexOf("Node 22 (Windows)")

  assert.ok(idxLinux < idxMacos)

  assert.ok(idxMacos < idxWindows)
})

void test("renderConsolidated orders deno columns by OS", () => {
  const md = renderConsolidated([
    makeResult({ node: "deno-2.9.3", platform: "win32", runtime: "deno" }, 1),

    makeResult({ node: "deno-2.9.3", platform: "darwin", runtime: "deno" }, 1),

    makeResult({ node: "deno-2.9.3", platform: "linux", runtime: "deno" }, 1),
  ])

  const idxLinux = md.indexOf("Deno 2.9.3 (Linux)")

  const idxMacos = md.indexOf("Deno 2.9.3 (macOS)")

  const idxWindows = md.indexOf("Deno 2.9.3 (Windows)")

  assert.ok(idxLinux < idxMacos)

  assert.ok(idxMacos < idxWindows)
})

void test("renderConsolidated orders deno columns by OS using deno's 'windows' platform value", () => {
  const md = renderConsolidated([
    makeResult({ node: "deno-2.9.3", platform: "windows", runtime: "deno" }, 1),

    makeResult({ node: "deno-2.9.3", platform: "darwin", runtime: "deno" }, 1),

    makeResult({ node: "deno-2.9.3", platform: "linux", runtime: "deno" }, 1),
  ])

  const idxLinux = md.indexOf("Deno 2.9.3 (Linux)")

  const idxMacos = md.indexOf("Deno 2.9.3 (macOS)")

  const idxWindows = md.indexOf("Deno 2.9.3 (Windows)")

  assert.ok(idxLinux < idxMacos)

  assert.ok(idxMacos < idxWindows)
})

void test("renderConsolidated handles an empty result set", () => {
  const md = renderConsolidated([])

  assert.match(md, /No benchmark artifacts found/u)
})
