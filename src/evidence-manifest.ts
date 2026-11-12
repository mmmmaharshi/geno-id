import { createHash } from "node:crypto"
import type { GenerationPlan, RepairPolicy } from "./algo.js"

export type EvidenceClaimType = "measured" | "inferred" | "proved"

export interface EvidenceEnvironment {
  runtime: string
  runtimeVersion: string
  platform: string
  arch: string
}

export interface EvidenceArtifact {
  path: string
  sha256: string
  bytes: number
}

export interface EvidenceClaim {
  id: string
  statement: string
  type: EvidenceClaimType
  summary: string
  uncertainty: string
  limitation: string
  artifacts: EvidenceArtifact[]
}

export interface EvidenceManifestInput {
  implementationCommit: string
  source: string
  compilerInput: unknown
  generationPlan: GenerationPlan
  repairPolicy?: RepairPolicy
  command: string
  environment: EvidenceEnvironment
  claims: EvidenceClaim[]
}

export interface EvidenceManifest extends Omit<EvidenceManifestInput, "source"> {
  sourceHash: string
}

export type EvidenceManifestErrorCode =
  | "missing-implementation"
  | "missing-source"
  | "missing-command"
  | "missing-environment"
  | "missing-claims"
  | "missing-artifacts"

export class EvidenceManifestError extends Error {
  readonly code: EvidenceManifestErrorCode
  readonly claim: string | undefined

  constructor(code: EvidenceManifestErrorCode, message: string, claim?: string) {
    super(message)
    this.name = "EvidenceManifestError"
    this.code = code
    this.claim = claim
  }
}

export type EvidenceArtifactState =
  | { path: string; status: "verified" }
  | { path: string; status: "missing" }
  | { path: string; status: "mismatch"; expected: string; actual: string | undefined }

export interface EvidenceArtifactReader {
  (path: string): { exists: boolean; bytes?: number; sha256?: string }
}

function requireText(value: unknown, code: EvidenceManifestErrorCode, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvidenceManifestError(code, `${field} is required`, field)
  }
  return value
}

export function createEvidenceManifest(input: EvidenceManifestInput): EvidenceManifest {
  if (!input || typeof input !== "object") {
    throw new EvidenceManifestError("missing-implementation", "manifest input is required")
  }
  const implementationCommit = requireText(input.implementationCommit, "missing-implementation", "implementationCommit")
  requireText(input.source, "missing-source", "source")
  const command = requireText(input.command, "missing-command", "command")
  if (!input.environment || typeof input.environment !== "object") {
    throw new EvidenceManifestError("missing-environment", "environment is required", "environment")
  }
  if (!Array.isArray(input.claims) || input.claims.length === 0) {
    throw new EvidenceManifestError("missing-claims", "at least one claim is required", "claims")
  }
  for (const claim of input.claims) {
    if (!claim.artifacts || claim.artifacts.length === 0) {
      throw new EvidenceManifestError("missing-artifacts", `claim ${claim.id} has no artifacts`, claim.id)
    }
  }
  return {
    implementationCommit,
    compilerInput: input.compilerInput,
    generationPlan: input.generationPlan,
    repairPolicy: input.repairPolicy,
    command,
    environment: input.environment,
    claims: input.claims,
    sourceHash: createHash("sha256").update(input.source).digest("hex"),
  }
}

export function verifyEvidenceArtifacts(
  manifest: EvidenceManifest,
  read: EvidenceArtifactReader,
): EvidenceArtifactState[] {
  return manifest.claims.flatMap((claim) =>
    claim.artifacts.map((artifact) => {
      const actual = read(artifact.path)
      if (!actual.exists) return { path: artifact.path, status: "missing" as const }
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) {
        return {
          path: artifact.path,
          status: "mismatch" as const,
          expected: artifact.sha256,
          actual: actual.sha256,
        }
      }
      return { path: artifact.path, status: "verified" as const }
    }),
  )
}
