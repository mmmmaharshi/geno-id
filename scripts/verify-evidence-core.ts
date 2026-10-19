import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

// The verification logic behind `scripts/verify-evidence.ts`, kept separate so
// it can be tested without touching the repository's own results directory.

export interface EvidenceTreeInput {
  package_version: string
  /** The version package.json reports, when it is known. */
  packageVersionFromPackage?: string
  /** The version the manifest's release-identity block names. */
  releaseIdentityVersion?: string
  artifacts: Record<string, { artifact: string }>
}

export interface MissingArtifact {
  id: string
  spec: string
}

export interface EvidenceTreeResult {
  checked: number
  missing: MissingArtifact[]
  /** Set when the manifest and the package disagree on their identity. */
  versionError: string | null
}

// A mapped artifact is a comma-separated list of paths; a glob means "every
// file matching it". Both forms must resolve to at least one file.
function resolveArtifact(spec: string, root: string): string[] {
  const trimmed = spec.trim()
  if (trimmed.includes("*")) {
    const dir = path.dirname(path.join(root, trimmed))
    const pattern = path.basename(trimmed)
    if (!existsSync(dir)) return []
    // A single `*` stands for any run of characters within one path segment.
    const [prefix, suffix] = pattern.split("*", 2)
    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
      .map((name) => path.join(dir, name))
  }
  const absolute = path.join(root, trimmed)
  return existsSync(absolute) ? [absolute] : []
}

export function verifyEvidenceTree(input: EvidenceTreeInput, root: string): EvidenceTreeResult {
  let checked = 0
  const missing: MissingArtifact[] = []
  for (const [id, entry] of Object.entries(input.artifacts)) {
    const specs = entry.artifact
      .split(/[,+]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const spec of specs) {
      checked++
      if (resolveArtifact(spec, root).length === 0) missing.push({ id, spec })
    }
  }

  let versionError: string | null = null
  if (
    input.packageVersionFromPackage !== undefined &&
    input.package_version !== input.packageVersionFromPackage
  ) {
    versionError = `manifest package_version ${input.package_version} != package.json ${input.packageVersionFromPackage}`
  } else if (
    input.releaseIdentityVersion !== undefined &&
    input.releaseIdentityVersion !== input.package_version
  ) {
    versionError = `release identity ${input.releaseIdentityVersion} != package.json ${input.package_version}`
  }

  return { checked, missing, versionError }
}
