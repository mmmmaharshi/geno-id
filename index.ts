// Public API barrel for the published `@manohar_maharshi/genoid` package.
//
// This is the curated consumer surface. `algo.ts` keeps additional exports that
// the repository's research/benchmark scripts (E1-E6, layout.test.ts) reach into
// directly; those are intentionally NOT re-exported here so npm consumers only
// see the supported generation + structured-composition API.

export {
  genGenoID,
  toUuidString,
  uuidToBytes,
  readStructured,
  completeLayout,
  genStructuredGenoID,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} from "./algo.js"

export type {
  FieldType,
  V8FieldConstraint as FieldConstraint,
  V8Field as Field,
  V8Layout as Layout,
} from "./algo.js"
