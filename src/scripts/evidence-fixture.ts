import {
  createEvidenceManifest,
  verifyEvidenceArtifacts,
} from "../../dist/evidence-manifest.js"

import { existsSync, readFileSync } from "node:fs"

import { mkdir, writeFile } from "node:fs/promises"

import { collisionTest } from "../../dist/bench-core.js"

import { createHash } from "node:crypto"

import { execFileSync } from "node:child_process"

import { nullValue } from "./shared/runtime-values.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

type EvidenceManifestInput = Parameters<typeof createEvidenceManifest>[0]

type EvidenceClaim = EvidenceManifestInput["claims"][number]

const root = path.resolve(import.meta.dirname, "..", "..")

const outDir = path.join(root, "results", "evidence-fixture")

const SAMPLE_SIZE = 10_000

const algo = (await import(
  pathToFileURL(path.join(root, "dist", "algo.js")).href
)) as {
  genStructuredGenoID: (layout: unknown) => string

  compileDatabaseLayout: (
    input: unknown,
  ) => {
    layout: unknown

    generationPlan: EvidenceManifestInput["generationPlan"]

    repairPolicy: NonNullable<EvidenceManifestInput["repairPolicy"]>
  }

  DBKEY_LAYOUT: { name: string; fields: unknown[] }

  getStructuredGenerationMode: () => string
}

const {
  genStructuredGenoID,
  compileDatabaseLayout,
  DBKEY_LAYOUT,
  getStructuredGenerationMode,
} = algo

const compilation = compileDatabaseLayout({
  schema: { fields: DBKEY_LAYOUT.fields, name: DBKEY_LAYOUT.name },

  workload: {
    fields: [
      { name: "shard", role: "partition" },

      { name: "counter", role: "lookup" },
    ],

    readWeight: 1,

    writeWeight: 1,
  },
})

const { layout } = compilation

const rawIds = Array.from({ length: SAMPLE_SIZE }, () =>
  genStructuredGenoID(layout),
)

const raw = `${rawIds.join("\n")}\n`

const rawPath = "results/evidence-fixture/uuids.txt"

const collisions = collisionTest(() => genStructuredGenoID(layout), SAMPLE_SIZE)

const claim: EvidenceClaim = {
  artifacts: [
    {
      bytes: Buffer.byteLength(raw),

      path: rawPath,

      sha256: createHash("sha256").update(raw).digest("hex"),
    },
  ],

  id: "fixture-structured-collision",

  limitation: "Does not estimate collision probability at production volume.",

  statement:
    "Structured UUID generation produces no duplicates in a bounded fixture run.",

  summary: `${collisions} collisions across ${SAMPLE_SIZE} identifiers from the compiled dbkey layout.`,

  type: "measured",

  uncertainty: "One bounded run on one machine.",
}

const bunVersion = process.versions.bun

let runtime = "node"

if (typeof bunVersion === "string") {
  runtime = "bun"
}

let runtimeVersion = process.versions.node

if (typeof bunVersion === "string") {
  runtimeVersion = bunVersion
}

const manifest = createEvidenceManifest({
  claims: [claim],

  command: "bun run evidence:fixture",

  compilerInput: {
    layout: DBKEY_LAYOUT.name,
    mode: getStructuredGenerationMode(),
  },

  environment: {
    arch: process.arch,

    platform: process.platform,

    runtime,

    runtimeVersion,
  },

  generationPlan: compilation.generationPlan,

  implementationCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),

  repairPolicy: compilation.repairPolicy,

  source: ["evidence-manifest.ts", "algo.ts"]

    .map((file) => readFileSync(path.join(root, file), "utf8"))

    .join("\n"),
})

await mkdir(outDir, { recursive: true })

await writeFile(path.join(outDir, "uuids.txt"), raw)

await writeFile(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(manifest, nullValue, 2)}\n`,
)

const states = verifyEvidenceArtifacts(manifest, (artifactPath) => {
  const absolute = path.join(root, artifactPath)

  if (!existsSync(absolute)) {
    return { exists: false }
  }

  const bytes = readFileSync(absolute)

  return {
    bytes: bytes.byteLength,

    exists: true,

    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
})

for (const state of states) {
  console.log(`${state.status} ${state.path}`)
}

const failed = states.some((state) => state.status !== "verified")

if (collisions === 0 && !failed) {
  console.log("EVIDENCE FIXTURE PASSED")
} else {
  console.log("EVIDENCE FIXTURE FAILED")
}

if (failed || collisions !== 0) {
  process.exitCode = 1
}
