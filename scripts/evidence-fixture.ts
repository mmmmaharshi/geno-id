import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { collisionTest } from "../dist/bench-core.js"
import { createEvidenceManifest, verifyEvidenceArtifacts } from "../dist/evidence-manifest.js"
import type { EvidenceClaim, EvidenceManifestInput } from "../dist/evidence-manifest.js"

const root = path.resolve(import.meta.dirname, "..")
const outDir = path.join(root, "results", "evidence-fixture")
const SAMPLE_SIZE = 10_000

const algo = await import(pathToFileURL(path.join(root, "dist", "algo.js")).href)
const { genStructuredGenoID, compileDatabaseLayout, DBKEY_LAYOUT, getStructuredGenerationMode } = algo as {
  genStructuredGenoID: (layout: unknown) => string
  compileDatabaseLayout: (input: unknown) => {
    layout: unknown
    generationPlan: EvidenceManifestInput["generationPlan"]
    repairPolicy: NonNullable<EvidenceManifestInput["repairPolicy"]>
  }
  DBKEY_LAYOUT: { name: string; fields: unknown[] }
  getStructuredGenerationMode: () => string
}

const compilation = compileDatabaseLayout({
  schema: { name: DBKEY_LAYOUT.name, fields: DBKEY_LAYOUT.fields },
  workload: {
    readWeight: 1,
    writeWeight: 1,
    fields: [
      { name: "shard", role: "partition" },
      { name: "counter", role: "lookup" },
    ],
  },
})
const layout = compilation.layout
const rawIds = Array.from({ length: SAMPLE_SIZE }, () => genStructuredGenoID(layout))
const raw = `${rawIds.join("\n")}\n`
const rawPath = "results/evidence-fixture/uuids.txt"
const collisions = collisionTest(() => genStructuredGenoID(layout), SAMPLE_SIZE)

const claim: EvidenceClaim = {
  id: "fixture-structured-collision",
  statement: "Structured UUID generation produces no duplicates in a bounded fixture run.",
  type: "measured",
  summary: `${collisions} collisions across ${SAMPLE_SIZE} identifiers from the compiled dbkey layout.`,
  uncertainty: "One bounded run on one machine.",
  limitation: "Does not estimate collision probability at production volume.",
  artifacts: [
    {
      path: rawPath,
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: Buffer.byteLength(raw),
    },
  ],
}

const manifest = createEvidenceManifest({
  implementationCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim(),
  source: ["evidence-manifest.ts", "algo.ts"]
    .map((file) => readFileSync(path.join(root, file), "utf-8"))
    .join("\n"),
  compilerInput: { layout: DBKEY_LAYOUT.name, mode: getStructuredGenerationMode() },
  generationPlan: compilation.generationPlan,
  repairPolicy: compilation.repairPolicy,
  command: "bun run evidence:fixture",
  environment: {
    runtime: process.versions.bun === undefined ? "node" : "bun",
    runtimeVersion: process.versions.bun ?? process.versions.node,
    platform: process.platform,
    arch: process.arch,
  },
  claims: [claim],
})

await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, "uuids.txt"), raw)
await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

const states = verifyEvidenceArtifacts(manifest, (artifactPath) => {
  const absolute = path.join(root, artifactPath)
  if (!existsSync(absolute)) return { exists: false }
  const bytes = readFileSync(absolute)
  return {
    exists: true,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
})

for (const state of states) console.log(`${state.status} ${state.path}`)
const failed = states.some((state) => state.status !== "verified")
console.log(collisions === 0 && !failed ? "EVIDENCE FIXTURE PASSED" : "EVIDENCE FIXTURE FAILED")
if (failed || collisions !== 0) process.exit(1)
