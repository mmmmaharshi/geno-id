import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Regression test for the single-parent structured-field population bug.
//
// Symptom (AGENTS.md, "Structured framework"): structured fields were written
// to only one pooled parent while `fieldSelect` could pick either parent, so
// ~50% of children inherited unpopulated CSPRNG garbage (e.g. tenant=3239
// instead of ≤8). The fix populates every structured field in BOTH pooled
// parents so per-field crossover always yields a valid value.
//
// This test pins the OBSERVABLE contract: no generated GenoID-structured UUID
// may ever violate a declared field constraint. It is verified to go RED when
// the single-parent bug is reintroduced (see PR description / mutation check),
// and GREEN at HEAD.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  genStructuredGenoID,
  readStructured,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
  DBKEY_LAYOUT,
} = algo as {
  genStructuredGenoID: (l: unknown) => string
  readStructured: (uuid: string, l: unknown) => Record<string, number>
  MULTITENANT_LAYOUT: unknown
  EVENTSOURCING_LAYOUT: unknown
  DBKEY_LAYOUT: unknown
}

function allowedOf(
  layout: unknown,
): Record<string, number[]> {
  const typed = layout as {
    fields: { name: string; constraint?: { allowed?: number[] } }[]
  }
  const out: Record<string, number[]> = {}
  for (const f of typed.fields) {
    if (f.constraint?.allowed) out[f.name] = f.constraint.allowed
  }
  return out
}

test("structured UUIDs never emit a field outside its allowed set (single-parent bug)", () => {
  for (const layout of [MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT, DBKEY_LAYOUT]) {
    const allowed = allowedOf(layout)
    if (Object.keys(allowed).length === 0) continue
    for (let i = 0; i < 500; i++) {
      const fields = readStructured(genStructuredGenoID(layout), layout)
      for (const [name, set] of Object.entries(allowed)) {
        assert.ok(
          set.includes(fields[name]),
          `field ${name}=${fields[name]} not in allowed ${JSON.stringify(set)}`,
        )
      }
    }
  }
})
