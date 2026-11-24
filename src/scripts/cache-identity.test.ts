/// <reference types="node" />

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

// Regression test for name-keyed cache aliasing (issue #32).

//

// Validation, pool state, tick/counter state, and the compiled-generator

// Cache were keyed by layout NAME. Two structurally different layouts

// Sharing a name silently shared counters, pools, and skipped validation.

// Caches are now keyed by a canonical hash of the field structure, and

// Name reuse with a differing structure fails closed.

//

// Contract pinned at the public-generator seam (`genStructuredGenoID`):

// Same-named differing layouts throw; identical re-declaration works.

// Verified RED on the old path (no throw), GREEN on the new path.

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  completeLayout,
  genStructuredGenoID,
  readStructured,
  resetSeededState,
} = algo as {
  completeLayout: (name: string, core: unknown[]) => unknown

  genStructuredGenoID: (l: unknown) => string

  readStructured: (uuid: string, l: unknown) => Record<string, number>

  resetSeededState: () => void
}

const tagLayout = (value: number): unknown =>
  completeLayout("dup", [
    { length: 8, name: "tag", start: 0, type: "fixed", value },
  ])

void test("same-named structurally different layouts fail closed at the public-generator seam", () => {
  const first = tagLayout(1)

  assert.match(genStructuredGenoID(first), /^[0-9a-f-]{36}$/u)

  const second = tagLayout(2)

  // Must throw, and the error must name the layout.

  assert.throws(() => genStructuredGenoID(second), /dup/u)
})

void test("identical re-declaration under the same name still generates", () => {
  const first = tagLayout(1)

  const redeclared = tagLayout(1)

  assert.match(genStructuredGenoID(first), /^[0-9a-f-]{36}$/u)

  const id = genStructuredGenoID(redeclared)

  assert.match(id, /^[0-9a-f-]{36}$/u)

  assert.equal(readStructured(id, redeclared).tag, 1)
})

void test("same-named differing layouts do not share validation", () => {
  const good = completeLayout("vld", [
    { length: 8, name: "tag", start: 0, type: "fixed", value: 1 },
  ])

  genStructuredGenoID(good)

  // Invalid structure (length<=0) under the same name must throw, never

  // Silently reuse the cached validation of the good layout.

  const bad = {
    fields: [{ length: 0, name: "bad", start: 0, type: "random" }],
    name: "vld",
  }

  assert.throws(() => genStructuredGenoID(bad), /vld/u)
})

void test("resetSeededState clears the name registry: re-declaration after reset registers fresh", () => {
  const first = tagLayout(1)

  genStructuredGenoID(first)

  resetSeededState()

  // Registry wiped: a differing structure under the same name registers

  // Anew instead of throwing on the stale binding.

  const second = tagLayout(2)

  const id = genStructuredGenoID(second)

  assert.equal(readStructured(id, second).tag, 2)
})
