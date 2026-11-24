/// <reference types="node" />

import assert from "node:assert/strict"

import path from "node:path"

import { readFileSync } from "node:fs"

import test from "node:test"

const root = path.resolve(import.meta.dirname, "..", "..")

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(path.resolve(root, rel), "utf8"))

interface ReferenceArtifact {
  rows: number

  arms: Record<string, { shardRangeScanMs: { mean: number } }>
}

interface ClusterArtifact {
  experiment: string

  description: string

  deployment: {
    nodes: number

    shardCountBefore: number

    shardCountAfter: number

    rows: number

    trials: number

    limits: string[]

    host: { logicalCores: number; runtime: string }
  }

  scan: {
    reference: {
      path: string
      arm: string
      rows: number
      rawShardRangeScanMs: number
      shardRangeScanMs: number
    }

    shardMajor: { meanMs: number; fullSweepMeanMs: number; samples: number }
  }

  reshard: {
    rowsMigrated: number

    rowsPerSec: number

    integrityOk: boolean

    dualRead: {
      trials: number
      readsPerTrial: number
      meanUs: number
      samplesUs: number[]
      v1Resolved: number
      v2Resolved: number
    }

    singleRead: {
      trials: number
      readsPerTrial: number
      meanUs: number
      samplesUs: number[]
    }
  }

  derived: {
    shard_major_scan_ratio_vs_single_index: number

    dual_read_overhead_ratio: number

    v2_resolved_fraction: number
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const meanOf = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length

const artifact = (): ClusterArtifact =>
  read("results/cluster-experiment.json") as ClusterArtifact

const reference = (pathInRepo: string): ReferenceArtifact =>
  read(pathInRepo) as ReferenceArtifact

void test("cluster artifact records host scale, shard counts, and stated limits", () => {
  const a = artifact()

  assert.equal(a.experiment, "cluster-shard-scan-reshard")

  assert.match(a.description, /not production-scale evidence/u)

  assert.equal(a.deployment.nodes, 1)

  assert.equal(a.deployment.shardCountBefore, 5)

  assert.equal(a.deployment.shardCountAfter, 8)

  assert.equal(a.deployment.rows, 100_000)

  assert.ok(a.deployment.host.logicalCores > 0)

  assert.ok(a.deployment.host.runtime.length > 0)

  assert.ok(a.deployment.limits.length >= 3)

  assert.ok(
    a.deployment.limits.some((s) => /not production-scale evidence/u.test(s)),
  )
})

void test("cluster scan comparison uses the frozen single-index artifact at the same row count", () => {
  const a = artifact()

  const ref = reference(a.scan.reference.path)

  const embeddedMean = ref.arms.embedded.shardRangeScanMs.mean

  assert.equal(a.scan.reference.arm, "embedded")

  assert.equal(a.scan.reference.rows, ref.rows)

  assert.equal(a.scan.reference.rows, a.deployment.rows)

  assert.equal(a.scan.reference.rawShardRangeScanMs, embeddedMean)

  assert.equal(a.scan.reference.shardRangeScanMs, round2(embeddedMean))

  assert.equal(
    a.derived.shard_major_scan_ratio_vs_single_index,

    round2(embeddedMean / a.scan.shardMajor.meanMs),
  )

  assert.ok(a.scan.shardMajor.meanMs > 0)

  assert.ok(a.scan.shardMajor.fullSweepMeanMs > 0)

  assert.equal(
    a.scan.shardMajor.samples,
    a.deployment.shardCountBefore * a.deployment.trials,
  )
})

void test("cluster reshard ratios match the archived read and migration measurements", () => {
  const a = artifact()

  assert.equal(a.reshard.rowsMigrated, 20_000)

  assert.ok(a.reshard.integrityOk)

  assert.ok(a.reshard.rowsPerSec > 0)

  const dualSamples: number[] = a.reshard.dualRead.samplesUs

  const singleSamples: number[] = a.reshard.singleRead.samplesUs

  assert.equal(dualSamples.length, a.reshard.dualRead.trials)

  assert.equal(singleSamples.length, a.reshard.singleRead.trials)

  const dualMean = round2(meanOf(dualSamples))

  const singleMean = round2(meanOf(singleSamples))

  assert.equal(a.reshard.dualRead.meanUs, dualMean)

  assert.equal(a.reshard.singleRead.meanUs, singleMean)

  assert.equal(
    a.derived.dual_read_overhead_ratio,

    round2(dualMean / singleMean),
  )

  const classified =
    a.reshard.dualRead.v1Resolved + a.reshard.dualRead.v2Resolved

  assert.equal(a.reshard.dualRead.trials, a.reshard.singleRead.trials)

  assert.equal(
    a.reshard.dualRead.readsPerTrial,
    a.reshard.singleRead.readsPerTrial,
  )

  assert.equal(classified, a.reshard.dualRead.readsPerTrial)

  assert.equal(
    a.derived.v2_resolved_fraction,
    round2(a.reshard.dualRead.v2Resolved / classified),
  )
})

void test("paper maps the cluster claim to its command and committed artifact", () => {
  const paper = readFileSync(path.resolve(root, "paper.tex"), "utf8")

  assert.match(paper, /bun run bench-cluster/u)

  assert.match(paper, /results\/cluster-experiment\.json/u)

  assert.match(paper, /sec:cluster/u)
})
