import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import { fromAny } from "@total-typescript/shoehorn"
import test from "node:test"
import {
  createEvidenceManifest,
  verifyEvidenceArtifacts,
} from "../../dist/evidence-manifest.js"
import type {
  EvidenceManifestInput,
  EvidenceManifestErrorCode,
} from "../../dist/evidence-manifest.js"
import type { GenerationPlan } from "../../dist/algo.js"

const environment = {
  arch: "x64",
  platform: "win32",
  runtime: "bun",
  runtimeVersion: "1.4.2",
}

const plan = {
  entropySource: "web-crypto",
  fieldSemantics: { shard: { constraints: ["allowed-set"], type: "shard" } },
  name: "compiled-direct-v8",
  poolMode: "direct",
  repairMode: "canonical",
} satisfies GenerationPlan

function baseInput(): EvidenceManifestInput {
  return {
    claims: [
      {
        artifacts: [{ path: "raw/uuids.txt", sha256: "a".repeat(64), bytes: 16 }],
        id: "fixture-uniqueness",
        limitation: "Not a collision-probability estimate.",
        statement: "Fixture identifiers are unique.",
        summary: "0 collisions in 10000 identifiers.",
        type: "measured",
        uncertainty: "Single bounded fixture run.",
      },
    ],
    command: "bun run evidence:fixture",
    compilerInput: { schema: "fixture", workload: { readWeight: 1, writeWeight: 1 } },
    environment,
    generationPlan: plan,
    implementationCommit: "abc123",
    source: "export const x = 1\n",
  }
}

test("createEvidenceManifest records identity, source hash, plan, and claims", () => {
  const manifest = createEvidenceManifest(baseInput())
  assert.equal(manifest.implementationCommit, "abc123")
  assert.equal(manifest.sourceHash, createHash("sha256").update("export const x = 1\n").digest("hex"))
  assert.deepEqual(manifest.generationPlan, plan)
  assert.equal(manifest.claims.length, 1)
  assert.equal(manifest.claims[0].id, "fixture-uniqueness")
})

test("createEvidenceManifest fails with stable codes for missing required data", () => {
  const cases: [EvidenceManifestErrorCode, () => unknown][] = [
    ["missing-implementation", () => ({ ...baseInput(), implementationCommit: "" })],
    ["missing-command", () => ({ ...baseInput(), command: "" })],
    ["missing-source", () => ({ ...baseInput(), source: "" })],
    ["missing-environment", () => ({ ...baseInput(), environment: undefined })],
    ["missing-claims", () => ({ ...baseInput(), claims: [] })],
    ["missing-artifacts", () => ({
      ...baseInput(),
      claims: [{ ...baseInput().claims[0], artifacts: [] }],
    })],
  ]
  for (const [code, build] of cases) {
    assert.throws(
      () => createEvidenceManifest(fromAny(build())),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal((error as Error & { code?: string }).code, code)
        return true
      },
    )
  }
})

test("verifyEvidenceArtifacts reports verified, missing, and mismatch states", () => {
  const manifest = createEvidenceManifest(baseInput())
  const states = verifyEvidenceArtifacts(manifest, (artifactPath) => {
    if (artifactPath === "raw/missing.txt") {return { exists: false }}
    if (artifactPath === "raw/changed.txt") {return { bytes: 16, exists: true, sha256: "b".repeat(64) }}
    return { bytes: 16, exists: true, sha256: "a".repeat(64) }
  })
  assert.deepEqual(states[0], { path: "raw/uuids.txt", status: "verified" })
})
