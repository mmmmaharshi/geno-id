import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Regression test for name-keyed cache aliasing (issue #32).
//
// Validation, pool state, tick/counter state, and the compiled-generator
// cache were keyed by layout NAME. Two structurally different layouts
// sharing a name silently shared counters, pools, and skipped validation.
// Caches are now keyed by a canonical hash of the field structure, and
// name reuse with a differing structure fails closed.
//
// Contract pinned at the public-generator seam (`genStructuredGenoID`):
// same-named differing layouts throw; identical re-declaration works.
// Verified RED on the old path (no throw), GREEN on the new path.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..", "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const { completeLayout, genStructuredGenoID, readStructured } = algo as {
  completeLayout: (name: string, core: unknown[]) => unknown
  genStructuredGenoID: (l: unknown) => string
  readStructured: (uuid: string, l: unknown) => Record<string, number>
}

function tagLayout(value: number) {
  return completeLayout("dup", [{ name: "tag", start: 0, length: 8, type: "fixed", value }])
}

test("same-named structurally different layouts fail closed at the public-generator seam", () => {
  const first = tagLayout(1)
  assert.match(genStructuredGenoID(first), /^[0-9a-f-]{36}$/)
  const second = tagLayout(2)
  // Must throw, and the error must name the layout.
  assert.throws(() => genStructuredGenoID(second), /dup/)
})

test("identical re-declaration under the same name still generates", () => {
  const first = tagLayout(1)
  const redeclared = tagLayout(1)
  assert.match(genStructuredGenoID(first), /^[0-9a-f-]{36}$/)
  const id = genStructuredGenoID(redeclared)
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.equal(readStructured(id, redeclared).tag, 1)
})

test("same-named differing layouts do not share validation", () => {
  const good = completeLayout("vld", [{ name: "tag", start: 0, length: 8, type: "fixed", value: 1 }])
  genStructuredGenoID(good)
  // Invalid structure (length<=0) under the same name must throw, never
  // silently reuse the cached validation of the good layout.
  const bad = { name: "vld", fields: [{ name: "bad", start: 0, length: 0, type: "random" }] }
  assert.throws(() => genStructuredGenoID(bad), /vld/)
})
