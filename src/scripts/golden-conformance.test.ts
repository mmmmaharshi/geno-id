/// <reference types="node" />
import assert from "node:assert/strict"

import fs from "node:fs"

import { need } from "../shared/need.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { readLines } from "./shared/read-lines.ts"

import { test } from "node:test"

// The golden vectors must cover every constraint kind the library supports,

// Not just the ones the shipped layouts happen to use. The conformance

// Layout exists for that: a range constraint (clamped, not remapped) and a

// Fixed field (a constant written at composition time) alongside the

// Allowed-set, monotonic, and >32-bit fields the shipped layouts cover.

//

// If the conformance vectors stop exercising a constraint kind, the Rust

// Cross-check stops proving anything about that kind, and this fails.

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist/algo.js")).href
)) as {
  CONFORMANCE_LAYOUT: {
    name: string

    fields: {
      name: string

      start: number

      length: number

      type: string

      value?: number

      constraint?: { min?: number; max?: number }
    }[]
  }

  getFieldValue: (bytes: Uint8Array, field: unknown) => bigint

  uuidToBytes: (uuid: string) => Uint8Array
}

const VECTORS = path.join(root, "golden", "conformance-single-parent.txt")

const layout = algo.CONFORMANCE_LAYOUT

const field = (name: string): typeof layout.fields[number] =>
  need(layout.fields.find((f) => f.name === name))

void test("the conformance layout declares a range constraint, a fixed field, and a wide field", () => {
  const window = field("window")

  const constraint = need(window.constraint)

  assert.equal(constraint.min, 100)

  assert.equal(constraint.max, 4999)

  const kind = field("kind")

  assert.equal(kind.type, "fixed")

  assert.equal(kind.value, 9)

  const wide = field("wide")

  assert.ok(
    wide.length > 32,
    `the wide field must exceed 32 bits, got ${wide.length}`,
  )
})

void test("every conformance vector satisfies the range constraint", () => {
  const lines = readLines(fs.readFileSync(VECTORS, "utf8"))

  assert.ok(lines.length > 0)

  const window = field("window")

  for (const line of lines) {
    const value = Number(algo.getFieldValue(algo.uuidToBytes(line), window))

    assert.ok(
      value >= 100 && value <= 4999,

      `window value ${value} is outside the declared range [100, 4999]`,
    )
  }
})

void test("every conformance vector carries the fixed field's constant", () => {
  const lines = readLines(fs.readFileSync(VECTORS, "utf8"))

  const kind = field("kind")

  for (const line of lines) {
    const value = Number(algo.getFieldValue(algo.uuidToBytes(line), kind))

    assert.equal(value, 9, `fixed field read ${value}, expected 9`)
  }
})

void test("the wide field takes distinct values across the vectors", () => {
  const lines = readLines(fs.readFileSync(VECTORS, "utf8"))

  const wide = field("wide")

  const values = new Set(
    lines.map((line) =>
      algo.getFieldValue(algo.uuidToBytes(line), wide).toString(),
    ),
  )

  // A wide field that always read the same value would carry no entropy and

  // Would not exercise the >32-bit path.

  assert.ok(
    values.size > lines.length / 2,
    `wide field had only ${values.size} distinct values`,
  )
})
