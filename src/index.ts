// Public API barrel for the published `@manohar_maharshi/genoid` package.

//

// This is the curated consumer surface. `algo.ts` keeps additional exports that

// The repository's research/benchmark scripts (E1-E6, layout.test.ts) reach into

// Directly; those are intentionally NOT re-exported here so npm consumers only

// See the supported generation + structured-composition API.

export {
  genGenoID,
  toUuidString,
  uuidToBytes,
  readStructured,
  completeLayout,
  compileLayout,
  compileDatabaseLayout,
  LayoutCompilerError,
  genStructuredGenoID,
  getStructuredGenerationMode,
  deriveWorkerId,
  splitMsFrac,
  stegoSeal,
  stegoOpen,
  experimentalIntegrityTag,
  experimentalIntegrityVerify,
  configureRandom,
  configurePools,
  configureFootprint,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
  CONFORMANCE_LAYOUT,
} from "./algo.js"

export type {
  FieldType,
  V8FieldConstraint as FieldConstraint,
  V8Field as Field,
  V8Layout as Layout,
  CompiledLayout,
  WorkloadFieldRole,
  WorkloadFieldProfile,
  DatabaseWorkloadProfile,
  LayoutSchema,
  LayoutSchemaField,
  LayoutCompilerInput,
  LayoutCompilerErrorCode,
  ConstraintKind,
  FieldSemantics,
  RepairPolicy,
  StructuredGenerationMode,
  GenerationPlan,
  LayoutCostReport,
  DatabaseLayoutCompilation,
} from "./algo.js"
