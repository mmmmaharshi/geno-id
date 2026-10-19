import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { verifyEvidenceTree } from "./verify-evidence-core.ts"

// The complete evidence command for the journal package.
//
// `results/artifact-manifest.json` maps every manuscript claim to the
// committed file under results/ that backs it, plus the command that
// produced it. This script checks that every mapped artifact is actually
// present, and that the package's own identity metadata agrees with the
// manifest. It exits non-zero when a required artifact is missing, so a
// reader can run one command to learn whether the package is complete
// rather than trusting that it is.
//
// Usage: bun run scripts/verify-evidence.ts

const root = path.resolve(import.meta.dirname, "..")
const MANIFEST = path.join(root, "results", "artifact-manifest.json")

interface Manifest {
  manifest_version: string
  commit: string
  package_version: string
  artifacts: Record<string, { artifact: string; generated?: string[] }>
  notes: {
    release_identity: { package_version: string; frozen_commit: string }
    unsupported_claims: string[]
    future_work: string[]
  }
}

function fail(message: string): never {
  console.error(`EVIDENCE VERIFICATION FAILED: ${message}`)
  process.exit(1)
}

if (!existsSync(MANIFEST)) fail(`missing ${path.relative(root, MANIFEST)}`)
const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8")) as Manifest
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
  version: string
}

const result = verifyEvidenceTree(
  {
    package_version: manifest.package_version,
    packageVersionFromPackage: pkg.version,
    releaseIdentityVersion: manifest.notes.release_identity.package_version,
    artifacts: manifest.artifacts,
  },
  root,
)

if (result.versionError) fail(result.versionError)
for (const entry of result.missing) {
  console.error(`  MISSING ${entry.id}: ${entry.spec}`)
}
if (result.missing.length > 0) {
  fail(`${result.missing.length} of ${result.checked} mapped artifacts are missing`)
}
console.log(
  `EVIDENCE VERIFIED: ${result.checked} artifacts present, package version ${pkg.version}, ${Object.keys(manifest.artifacts).length} claims mapped.`,
)
