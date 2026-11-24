/// <reference types="node" />

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { fromAny } from "@total-typescript/shoehorn"

import type { GenerationPlan } from "../../dist/algo.js"
import type {
  EvidenceArtifactState,
  EvidenceManifest,
  EvidenceManifestErrorCode,
  EvidenceManifestInput,
} from "../../dist/evidence-manifest.js"

const undefinedValue: undefined = Reflect.get({}, "missing") as undefined

const evidence = (await import("../../dist/evidence-manifest.js")) as {
  createEvidenceManifest: (input: unknown) => EvidenceManifest

  verifyEvidenceArtifacts: (
    manifest: unknown,

    read: (path: string) => Readonly<{
      readonly exists: boolean
      readonly bytes?: number
      readonly sha256?: string
    }>
  ) => EvidenceArtifactState[]
}

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

const baseInput = (): EvidenceManifestInput => ({
  claims: [
    {
      artifacts: [{ bytes: 16, path: "raw/uuids.txt", sha256: "a".repeat(64) }],

      id: "fixture-uniqueness",

      limitation: "Not a collision-probability estimate.",

      statement: "Fixture identifiers are unique.",

      summary: "0 collisions in 10000 identifiers.",

      type: "measured",

      uncertainty: "Single bounded fixture run.",
    },
  ],

  command: "bun run evidence:fixture",

  compilerInput: {
    schema: "fixture",
    workload: { readWeight: 1, writeWeight: 1 },
  },

  environment,

  generationPlan: plan,

  implementationCommit: "abc123",

  source: "export const x = 1\n",
})

void test("createEvidenceManifest records identity, source hash, plan, and claims", () => {
  const manifest = evidence.createEvidenceManifest(baseInput())

  assert.equal(manifest.implementationCommit, "abc123")

  assert.equal(
    manifest.sourceHash,
    createHash("sha256").update("export const x = 1\n").digest("hex")
  )

  assert.deepEqual(manifest.generationPlan, plan)

  assert.equal(manifest.claims.length, 1)

  assert.equal(manifest.claims[0].id, "fixture-uniqueness")
})

void test("createEvidenceManifest fails with stable codes for missing required data", () => {
  const cases: [EvidenceManifestErrorCode, () => unknown][] = [
    [
      "missing-implementation",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          { implementationCommit: "" }
        ),
    ],

    [
      "missing-command",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          { command: "" }
        ),
    ],

    [
      "missing-source",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          { source: "" }
        ),
    ],

    [
      "missing-environment",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          { environment: undefinedValue }
        ),
    ],

    [
      "missing-claims",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          { claims: [] }
        ),
    ],

    [
      "missing-artifacts",
      () =>
        Object.assign(
          Object.create(Object.prototype) as EvidenceManifestInput,
          baseInput(),
          {
            claims: [
              Object.assign(
                Object.create(
                  Object.prototype
                ) as EvidenceManifestInput["claims"][number],
                baseInput().claims[0],
                { artifacts: [] }
              ),
            ],
          }
        ),
    ],
  ]

  for (const [code, build] of cases) {
    assert.throws(
      () => evidence.createEvidenceManifest(fromAny(build())),

      { code }
    )
  }
})

void test("verifyEvidenceArtifacts reports verified, missing, and mismatch states", () => {
  const manifest = evidence.createEvidenceManifest(baseInput())

  const states = evidence.verifyEvidenceArtifacts(manifest, (artifactPath) => {
    if (artifactPath === "raw/missing.txt") {
      return { exists: false }
    }

    if (artifactPath === "raw/changed.txt") {
      return { bytes: 16, exists: true, sha256: "b".repeat(64) }
    }

    return { bytes: 16, exists: true, sha256: "a".repeat(64) }
  })

  assert.deepEqual(states[0], { path: "raw/uuids.txt", status: "verified" })
})
