import { existsSync, readFileSync } from "node:fs"
import { nullValue, undefinedValue } from "./shared/runtime-values.ts"
import path from "node:path"
import { verifyEvidenceTree } from "./verify-evidence-core.ts"

// The complete evidence command for the journal package.
//
// `results/artifact-manifest.json` maps every manuscript claim to the
// Committed file under results/ that backs it, plus the command that
// Produced it. This script checks that every mapped artifact is actually
// Present, and that the package's own identity metadata agrees with the
// Manifest. It exits non-zero when a required artifact is missing, so a
// Reader can run one command to learn whether the package is complete
// Rather than trusting that it is.
//
// Usage: bun run src/scripts/verify-evidence.ts

const root = path.resolve(import.meta.dirname, "..", "..")
const MANIFEST = path.join(root, "results", "artifact-manifest.json")

interface Manifest {
  manifest_version: string
  commit: string
  package_version: string
  artifacts: Record<string, { artifact: string; generated?: string[] }>
  metrics?: { artifact: string; path: string; value: number; precision?: number }[]
  notes: {
    release_identity: { package_version: string; frozen_commit: string }
    unsupported_claims: string[]
    future_work: string[]
  }
}

const fail = (message: string): boolean => {
  console.error(`EVIDENCE VERIFICATION FAILED: ${message}`)
  process.exitCode = 1
  return true
}

const verify = (): void => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as {
    version: string
  }

  const result = verifyEvidenceTree(
    {
      artifacts: manifest.artifacts,
      metrics: manifest.metrics,
      packageVersionFromPackage: pkg.version,
      package_version: manifest.package_version,
      releaseIdentityVersion: manifest.notes.release_identity.package_version,
    },
    root,
  )

  if (
    result.versionError !== nullValue &&
    result.versionError.length > 0 &&
    fail(result.versionError)
  ) {
    return
  }
  for (const entry of result.missing) {
    console.error(`  MISSING ${entry.id}: ${entry.spec}`)
  }
  if (
    result.missing.length > 0 &&
    fail(
      `${result.missing.length} of ${result.checked} mapped artifacts are missing`,
    )
  ) {
    return
  }
  for (const m of result.metricMismatches) {
    console.error(
      `  METRIC DRIFT ${m.expectation.artifact}:${m.expectation.path} claim=${m.expectation.value} actual=${m.actual ?? "missing"}`,
    )
  }
  if (
    result.metricMismatches.length > 0 &&
    fail(
      `${result.metricMismatches.length} manifest metric claim(s) drifted from their artifacts`,
    )
  ) {
    return
  }
  let metricCount = 0
  if (manifest.metrics !== undefinedValue) {
    metricCount = manifest.metrics.length
  }
  console.log(
    `EVIDENCE VERIFIED: ${result.checked} artifacts present, ${metricCount} metric claims checked, package version ${pkg.version}, ${Object.keys(manifest.artifacts).length} claims mapped.`,
  )
}

if (existsSync(MANIFEST)) {
  verify()
} else {
  fail(`missing ${path.relative(root, MANIFEST)}`)
}
