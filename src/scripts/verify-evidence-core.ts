import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

// The verification logic behind `src/scripts/verify-evidence.ts`, kept separate so
// it can be tested without touching the repository's own results directory.

export interface MetricExpectation {
  /** Artifact path, relative to root, whose JSON is read. */
  artifact: string
  /** Dot-separated path into the parsed JSON. */
  path: string
  /** Value the manuscript and manifest claim. */
  value: number
  /** Decimal places both sides are rounded to before comparison. */
  precision?: number
}

export interface MetricMismatch {
  expectation: MetricExpectation
  actual: number | null
}

export interface MissingArtifact {
  id: string
  spec: string
}

export interface EvidenceTreeInput {
  package_version: string
  /** The version package.json reports, when it is known. */
  packageVersionFromPackage?: string
  /** The version the manifest's release-identity block names. */
  releaseIdentityVersion?: string
  artifacts: Record<string, { artifact: string }>
  /** Machine-readable numeric claims pinned to fields in their artifacts. */
  metrics?: MetricExpectation[]
}

export interface EvidenceTreeResult {
  checked: number
  missing: MissingArtifact[]
  /** Set when the manifest and the package disagree on their identity. */
  versionError: string | null
  /** Metric expectations whose artifact value no longer matches the claim. */
  metricMismatches: MetricMismatch[]
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

  const metricMismatches: MetricMismatch[] = []
  for (const expectation of input.metrics ?? []) {
    const file = path.join(root, expectation.artifact)
    let actual: number | null = null
    if (existsSync(file)) {
      const json = JSON.parse(readFileSync(file, "utf-8")) as unknown
      let node: unknown = json
      for (const key of expectation.path.split(".")) {
        node = node !== null && typeof node === "object" && key in node
          ? (node as Record<string, unknown>)[key]
          : undefined
      }
      if (typeof node === "number") actual = node
    }
    const round = (n: number): number =>
      expectation.precision === undefined ? n : Number(n.toFixed(expectation.precision))
    if (actual === null || round(actual) !== round(expectation.value)) {
      metricMismatches.push({ expectation, actual })
    }
  }

  return { checked, missing, versionError, metricMismatches }
}
