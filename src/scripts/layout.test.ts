/// <reference types="node" />

import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

import type { V8Field, V8Layout } from "../../dist/algo.js"
import { andBits, shiftRightBits } from "../shared/bitwise.ts"

interface ReadonlyV8Field {
  readonly name: string

  readonly start: number

  readonly length: number

  readonly type: V8Field["type"]

  readonly value?: number

  readonly constraint?: {
    readonly allowed?: readonly number[]

    readonly min?: number

    readonly max?: number

    readonly monotonic?: boolean
  }
}

interface ReadonlyV8Layout {
  readonly name: string

  readonly fields: readonly ReadonlyV8Field[]
}

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  completeLayout,

  composeStructured,

  copyField,

  genStructuredParent,

  repairConstraints,

  getFieldValue,

  uuidToBytes,

  uuidToRandomBits,

  genStructuredGenoID,

  DBKEY_LAYOUT,
} = algo as {
  completeLayout: (name: string, core: readonly ReadonlyV8Field[]) => V8Layout

  composeStructured: (
    l: ReadonlyV8Layout,
    a: Readonly<Uint8Array>,
    b: Readonly<Uint8Array>,
    fs: number
  ) => Uint8Array

  copyField: (dst: Uint8Array, src: Uint8Array, field: ReadonlyV8Field) => void

  genStructuredParent: (
    l: ReadonlyV8Layout,
    mask: readonly number[]
  ) => Uint8Array

  repairConstraints: (l: ReadonlyV8Layout, b: Readonly<Uint8Array>) => number

  getFieldValue: (b: Readonly<Uint8Array>, f: ReadonlyV8Field) => bigint

  uuidToBytes: (uuid: string) => Uint8Array

  uuidToRandomBits: (uuid: string, layout: ReadonlyV8Layout) => string

  genStructuredGenoID: (l: ReadonlyV8Layout) => string

  DBKEY_LAYOUT: V8Layout
}

const dbkey = DBKEY_LAYOUT

const totalBits = dbkey.fields

  .filter((f) => f.type === "random")

  .reduce((s, f) => s + f.length, 0)

void test("completeLayout covers all 128 bits and leaves reserved nibbles as gaps", () => {
  const covered = Array.from<boolean>({ length: 128 }).fill(false)

  for (const f of dbkey.fields) {
    for (let i = 0; i < f.length; i += 1) {
      covered[f.start + i] = true
    }
  }

  // 128 bits minus the 6 reserved v8 nibble bits (48-51, 64-65) are covered

  // By declared + random-filler fields.

  assert.equal(covered.filter(Boolean).length, 122)

  for (const r of [48, 49, 50, 51, 64, 65]) {
    assert.equal(covered[r], false)
  }

  assert.ok(dbkey.fields.some((f) => f.type === "random"))
})

void test("composeStructured inherits each structured field from exactly one parent", () => {
  const structIdx = dbkey.fields

    .map((f, i) => ({ f, i }))

    .filter(({ f }) => f.type !== "random")

    .map(({ i }) => i)

  const A = genStructuredParent(dbkey, structIdx)

  const B = genStructuredParent(dbkey, structIdx)

  for (let fs = 0; fs < 64; fs += 1) {
    const child = composeStructured(dbkey, A, B, fs)

    for (const [fi, f] of dbkey.fields.entries()) {
      if (f.type !== "random") {
        let src = B

        if (andBits(shiftRightBits(fs, fi), 1) === 1) {
          src = A
        }

        assert.equal(getFieldValue(child, f), getFieldValue(src, f))
      }
    }
  }

  const {
    fields: [unaligned],
  } = completeLayout("repeat-copy", [
    { length: 3, name: "bits", start: 2, type: "random" },
  ])

  const source = new Uint8Array(16).fill(0xff)

  const target = new Uint8Array(16).fill(0xff)

  copyField(target, source, unaligned)

  const once = new Uint8Array(target)

  copyField(target, source, unaligned)

  assert.deepEqual(target, once)

  source.fill(0)

  copyField(target, source, unaligned)

  const cleared = new Uint8Array(target)

  copyField(target, source, unaligned)

  assert.deepEqual(target, cleared)

  assert.equal(getFieldValue(target, unaligned), 0n)
})

void test("repairConstraints fixes violations and reports repair count", () => {
  const layout = completeLayout("k2", [
    {
      constraint: { allowed: [0, 1, 2, 3] },
      length: 8,
      name: "c0",
      start: 0,
      type: "random",
    },

    {
      constraint: { allowed: [0, 1, 2, 3] },
      length: 8,
      name: "c1",
      start: 8,
      type: "random",
    },
  ])

  for (let t = 0; t < 200; t += 1) {
    const bytes = new Uint8Array(16)

    crypto.getRandomValues(bytes)

    bytes[0] = 200

    bytes[1] = 200

    const repairs = repairConstraints(layout, bytes)

    assert.ok(repairs >= 1 && repairs <= 2)

    const first = Number(getFieldValue(bytes, layout.fields[0]))

    const second = Number(getFieldValue(bytes, layout.fields[1]))

    assert.ok([0, 1, 2, 3].includes(first))

    assert.ok([0, 1, 2, 3].includes(second))
  }
})

void test("getFieldValue reads the leading field bits as an exact BigInt", () => {
  const layout = completeLayout("f", [
    { length: 16, name: "x", start: 0, type: "random" },
  ])

  const b = uuidToBytes("1a2b3c4d-0000-8000-8000-000000000000")

  assert.equal(getFieldValue(b, layout.fields[0]), 0x1a_2bn)
})

void test("uuidToBytes decodes the canonical UUID byte order", () => {
  const b = uuidToBytes("1a2b3c4d-0000-8000-8000-000000000000")

  assert.equal(b[0], 0x1a)

  assert.equal(b[1], 0x2b)

  assert.equal(b[2], 0x3c)

  assert.equal(b[3], 0x4d)

  assert.equal(b.length, 16)
})

void test("uuidToRandomBits emits only random-field bits, produces correct-length output", () => {
  const bits = uuidToRandomBits(genStructuredGenoID(dbkey), dbkey)

  assert.equal(bits.length, totalBits)

  assert.match(bits, /^[01]+$/u)

  const again = uuidToRandomBits(genStructuredGenoID(dbkey), dbkey)

  assert.equal(again.length, totalBits)
})
