import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import {
  createEvidenceManifest,
  verifyEvidenceArtifacts,
} from "../dist/evidence-manifest.js"
import type {
  EvidenceManifestInput,
  EvidenceManifestErrorCode,
} from "../dist/evidence-manifest.js"
import type { GenerationPlan } from "../dist/algo.js"

const environment = {
  runtime: "bun",
  runtimeVersion: "1.4.2",
  platform: "win32",
  arch: "x64",
}

const plan = {
  name: "compiled-direct-v8",
  entropySource: "web-crypto",
  poolMode: "direct",
  repairMode: "canonical",
  fieldSemantics: { shard: { type: "shard", constraints: ["allowed-set"] } },
} satisfies GenerationPlan

function baseInput(): EvidenceManifestInput {
  return {
    implementationCommit: "abc123",
    source: "export const x = 1\n",
    compilerInput: { schema: "fixture", workload: { readWeight: 1, writeWeight: 1 } },
    generationPlan: plan,
    command: "bun run evidence:fixture",
    environment,
    claims: [
      {
        id: "fixture-uniqueness",
        statement: "Fixture identifiers are unique.",
        type: "measured",
        summary: "0 collisions in 10000 identifiers.",
        uncertainty: "Single bounded fixture run.",
        limitation: "Not a collision-probability estimate.",
        artifacts: [{ path: "raw/uuids.txt", sha256: "a".repeat(64), bytes: 16 }],
      },
    ],
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
      () => createEvidenceManifest(build() as never),
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
    if (artifactPath === "raw/missing.txt") return { exists: false }
    if (artifactPath === "raw/changed.txt") return { exists: true, bytes: 16, sha256: "b".repeat(64) }
    return { exists: true, bytes: 16, sha256: "a".repeat(64) }
  })
  assert.deepEqual(states[0], { path: "raw/uuids.txt", status: "verified" })
})
