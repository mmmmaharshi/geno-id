import { createHash } from "node:crypto"

import type { GenerationPlan, RepairPolicy } from "./algo.js"
import { isArray, isRecord } from "./shared/need.js"

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value

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

export interface EvidenceManifest extends Omit<
  EvidenceManifestInput,
  "source"
> {
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
  public readonly code: EvidenceManifestErrorCode

  public readonly claim: string | undefined

  public constructor(
    code: EvidenceManifestErrorCode,
    message: string,
    claim?: string
  ) {
    super(message)

    this.name = "EvidenceManifestError"

    this.code = code

    this.claim = claim
  }
}

export type EvidenceArtifactState =
  | { path: string; status: "verified" }
  | {
      path: string
      status: "missing"
    }
  | {
      path: string
      status: "mismatch"
      expected: string
      actual: string | undefined
    }

export type EvidenceArtifactReader = (path: string) => {
  exists: boolean
  bytes?: number
  sha256?: string
}

const requireText = (
  value: unknown,
  code: EvidenceManifestErrorCode,
  field: string
): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new EvidenceManifestError(code, `${field} is required`, field)
  }

  return value
}

export const createEvidenceManifest = (
  input: DeepReadonly<EvidenceManifestInput>
): EvidenceManifest => {
  if (!isRecord(input)) {
    throw new EvidenceManifestError(
      "missing-implementation",
      "manifest input is required"
    )
  }

  const implementationCommit = requireText(
    input.implementationCommit,
    "missing-implementation",
    "implementationCommit"
  )

  requireText(input.source, "missing-source", "source")

  const command = requireText(input.command, "missing-command", "command")

  if (!isRecord(input.environment)) {
    throw new EvidenceManifestError(
      "missing-environment",
      "environment is required",
      "environment"
    )
  }

  const { claims } = input

  if (!isArray(claims) || claims.length === 0) {
    throw new EvidenceManifestError(
      "missing-claims",
      "at least one claim is required",
      "claims"
    )
  }

  for (const claim of claims) {
    if (!isArray(claim.artifacts) || claim.artifacts.length === 0) {
      throw new EvidenceManifestError(
        "missing-artifacts",
        `claim ${claim.id} has no artifacts`,
        claim.id
      )
    }
  }

  return {
    claims,

    command,

    compilerInput: input.compilerInput,

    environment: input.environment,

    generationPlan: input.generationPlan,

    implementationCommit,

    repairPolicy: input.repairPolicy,

    sourceHash: createHash("sha256").update(input.source).digest("hex"),
  } as EvidenceManifest
}

export const verifyEvidenceArtifacts = (
  manifest: DeepReadonly<EvidenceManifest>,

  read: EvidenceArtifactReader
): EvidenceArtifactState[] =>
  manifest.claims.flatMap((claim) =>
    claim.artifacts.map((artifact) => {
      const actual = read(artifact.path)

      if (!actual.exists) {
        return { path: artifact.path, status: "missing" as const }
      }

      if (
        actual.sha256 !== artifact.sha256 ||
        actual.bytes !== artifact.bytes
      ) {
        return {
          actual: actual.sha256,

          expected: artifact.sha256,

          path: artifact.path,

          status: "mismatch" as const,
        }
      }

      return { path: artifact.path, status: "verified" as const }
    })
  )
