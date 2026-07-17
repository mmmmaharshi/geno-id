# genoid

## 1.2.0

### Minor Changes

- Phase A evidence: add comparison baselines (pg_uuid_v8, ULID, ULID-v8, KSUID,
  Snowflake) with TDD tests, scale collision testing to 10M (exact BigInt), run
  NIST SP 800-22 on baseline random payloads (pg_uuid_v8 and ULID-v8 pass all 15),
  and add payload-only uniformity measurement for timestamped IDs. Document the
  automatic-versioning policy and render the README Evaluation section as a table.

## 1.1.0

### Minor Changes

- Add declarative RFC 9562 v8 structured-layout framework (genStructuredGenoID,
  composeStructured, repairConstraints, readStructured, completeLayout),
  node:test suites, TDD workflow, and the Bun toolchain; fix 32-bit truncation
  and single-parent population bugs.
