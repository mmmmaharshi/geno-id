import assert from "node:assert/strict"
import { test } from "node:test"
import { envLabel, renderConsolidated } from "./ci-consolidate.ts"
import type { CIBenchmarkResult, EnvInfo } from "./ci-result.ts"

function makeResult(env: Partial<EnvInfo>, ops: number): CIBenchmarkResult {
  const full: EnvInfo = {
    runtime: "bun",
    bun: "1.3.0",
    node: "",
    platform: "linux",
    arch: "x64",
    cpuModel: "test",
    cpuCount: 8,
    totalMemoryMB: 16000,
    ...env,
  }
  return {
    environment: full,
    benchmarks: [{ name: "v4", opsPerSec: ops, usPerOp: 0, ci95: [ops, ops], std: 0, trials: 10 }],
    collisions: [{ name: "v4", n: 1000000, collisions: 0 }],
  }
}

test("envLabel labels bun environments by OS", () => {
  assert.equal(envLabel({ runtime: "bun", platform: "linux", bun: "1" } as EnvInfo), "Ubuntu (Bun)")
  assert.equal(envLabel({ runtime: "bun", platform: "darwin", bun: "1" } as EnvInfo), "macOS (Bun)")
  assert.equal(envLabel({ runtime: "bun", platform: "win32", bun: "1" } as EnvInfo), "Windows (Bun)")
})

test("envLabel labels node environments with version", () => {
  assert.equal(
    envLabel({ runtime: "node", node: "22", platform: "linux" } as EnvInfo),
    "Node 22 (Linux)",
  )
})

test("renderConsolidated renders a header and one column per environment", () => {
  const md = renderConsolidated([
    makeResult({ runtime: "node", node: "22", bun: null, platform: "linux" }, 12_500_000),
    makeResult({ runtime: "bun", bun: "1", platform: "linux" }, 11_192_453),
  ])
  assert.match(md, /## GenoID CI benchmark — consolidated/)
  assert.match(md, /Ubuntu \(Bun\)/)
  assert.match(md, /Node 22 \(Linux\)/)
  assert.match(md, /\| v4 \|/)
  assert.match(md, /11\.19M/)
  assert.match(md, /PASS/)
})

test("renderConsolidated orders columns bun-first then node by version", () => {
  const md = renderConsolidated([
    makeResult({ runtime: "node", node: "23", bun: null, platform: "linux" }, 1),
    makeResult({ runtime: "node", node: "20", bun: null, platform: "linux" }, 1),
    makeResult({ runtime: "bun", bun: "1", platform: "darwin" }, 1),
    makeResult({ runtime: "bun", bun: "1", platform: "linux" }, 1),
  ])
  const idxUbuntu = md.indexOf("Ubuntu (Bun)")
  const idxMacos = md.indexOf("macOS (Bun)")
  const idxNode20 = md.indexOf("Node 20 (Linux)")
  const idxNode23 = md.indexOf("Node 23 (Linux)")
  assert.ok(idxUbuntu < idxMacos)
  assert.ok(idxMacos < idxNode20)
  assert.ok(idxNode20 < idxNode23)
})

test("renderConsolidated handles an empty result set", () => {
  const md = renderConsolidated([])
  assert.match(md, /No benchmark artifacts found/)
})
