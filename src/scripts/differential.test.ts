/// <reference types="node" />

import type { CompiledRawLayout, V8Field, V8Layout } from "../../dist/algo.js"

import { andBits } from "../shared/bitwise.ts"

import assert from "node:assert/strict"

import path from "node:path"

import { pathToFileURL } from "node:url"
import { test } from "node:test"

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

const root = path.resolve(import.meta.dirname, "..", "..")

const algo: unknown = await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)

const {
  compileRawLayout,
  interpretRawLayout,
  getFieldValue,
  uuidToBytes,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} = algo as {
  compileRawLayout: (l: Readonly<V8Layout>) => CompiledRawLayout

  interpretRawLayout: (
    l: Readonly<V8Layout>,
    raw: Readonly<Uint8Array>,
    now: number,
    ctr: number,
  ) => string

  getFieldValue: (b: Readonly<Uint8Array>, f: ReadonlyV8Field) => bigint

  uuidToBytes: (u: string) => Uint8Array

  DBKEY_LAYOUT: V8Layout

  MULTITENANT_LAYOUT: V8Layout

  EVENTSOURCING_LAYOUT: V8Layout
}

const V8_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const rawBytes = (v: readonly number[]): Uint8Array => {
  const b = new Uint8Array(16)

  for (let i = 0; i < Math.min(v.length, 16); i += 1) {
    b[i] = v[i]
  }

  return b
}

const generateRaw = (): Uint8Array => {
  const b = new Uint8Array(16)

  for (let i = 0; i < 16; i += 1) {
    b[i] = Math.trunc(Math.random() * 256)
  }

  return b
}

const EDGE_CASES: Uint8Array[] = [
  rawBytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),

  rawBytes([
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255,
  ]),

  rawBytes([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),

  rawBytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),

  rawBytes([
    0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F,
    0x0F, 0x0F, 0x0F, 0x0F,
  ]),

  rawBytes([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),

  rawBytes([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),

  rawBytes([
    0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
    0x00, 0xFF, 0x00, 0xFF,
  ]),

  rawBytes([
    0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55,
    0x55, 0x55, 0x55, 0x55,
  ]),

  rawBytes([
    0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA,
    0xAA, 0xAA, 0xAA, 0xAA,
  ]),
]

const bytesHex = (b: Uint8Array): string => {
  let s = ""

  for (const v of b) {
    s += v.toString(16).padStart(2, "0")
  }

  return s
}

interface LayoutCfg {
  name: string

  layout: V8Layout

  constraints: { field: string; check: (v: number) => boolean }[]
}

const LAYOUTS: LayoutCfg[] = [
  {
    constraints: [
      { check: (v: number) => v >= 1 && v <= 5, field: "shard" },

      { check: (_v: number) => true, field: "counter" },
    ],

    layout: DBKEY_LAYOUT,

    name: "dbkey",
  },

  {
    constraints: [
      { check: (v: number) => v >= 1 && v <= 8, field: "tenant" },

      { check: (v: number) => v >= 1 && v <= 4, field: "region" },
    ],

    layout: MULTITENANT_LAYOUT,

    name: "multitenant",
  },

  {
    constraints: [{ check: (_v: number) => true, field: "seq" }],

    layout: EVENTSOURCING_LAYOUT,

    name: "eventsourcing",
  },
]

interface TestCtx {
  rawLayout: CompiledRawLayout

  fieldMap: Record<string, V8Field>

  tsField: V8Field | undefined

  ctrFields: V8Field[]
}

const makeCtx = (layout: Readonly<V8Layout>): TestCtx => {
  const rawLayout = compileRawLayout(layout)

  const fieldMap: Record<string, V8Field> = {}

  for (const f of layout.fields) {
    fieldMap[f.name] = f
  }

  const tsField = layout.fields.find(
    (f) => f.type === "timestamp-ms" || f.type === "timestamp-us",
  )

  const ctrFields = layout.fields.filter((f) => f.type === "counter")

  return { ctrFields, fieldMap, rawLayout, tsField }
}

const pendingTests: Promise<void>[] = []

for (const lt of LAYOUTS) {
  const ctx = makeCtx(lt.layout)

  const FIXED_TS = 1_700_000_000_000

  const differential =
    test(`${lt.name}: differential — compiled === interpreted for 100k random vectors`, () => {
      const raws: Uint8Array[] = []

      for (let i = 0; i < 100_000; i += 1) {
        raws.push(generateRaw())
      }

      for (let i = 0; i < raws.length; i += 1) {
        const raw = raws[i]

        const compiled = ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, i)

        const interpreted = interpretRawLayout(lt.layout, raw, FIXED_TS, i)

        if (compiled !== interpreted) {
          throw new Error(
            `${lt.name}[${i}]: compiled "${compiled}" !== interpreted "${interpreted}" for ` +
              `raw=${bytesHex(raw)} ts=${FIXED_TS} ctr=${i}`,
          )
        }
      }
    })

  const edgeCases = test(`${lt.name}: differential — edge cases`, () => {
    for (const raw of EDGE_CASES) {
      const compiled = ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0)

      const interpreted = interpretRawLayout(lt.layout, raw, FIXED_TS, 0)

      assert.equal(compiled, interpreted)
    }
  })

  const properties =
    test(`${lt.name}: property — valid format + constraints`, () => {
      const raws: Uint8Array[] = []

      for (let i = 0; i < 10_000; i += 1) {
        raws.push(generateRaw())
      }

      for (let i = 0; i < raws.length; i += 1) {
        const uuid = ctx.rawLayout.fn(new Uint8Array(raws[i]), FIXED_TS, i)

        if (!V8_RE.test(uuid)) {
          throw new Error(`${lt.name}: invalid format`)
        }

        const b = uuidToBytes(uuid)

        if (andBits(b[6], 0xF0) !== 0x80) {
          throw new Error(`${lt.name}: version nibble wrong`)
        }

        if (andBits(b[8], 0xC0) !== 0x80) {
          throw new Error(`${lt.name}: variant bits wrong`)
        }

        for (const { field: fname, check } of lt.constraints) {
          const v = Number(getFieldValue(b, ctx.fieldMap[fname]))

          if (!check(v)) {
            throw new Error(
              `${lt.name}: field ${fname}=${v} violates constraint`,
            )
          }
        }
      }
    })

  const deterministic = test(`${lt.name}: deterministic`, () => {
    const raw = generateRaw()

    const expected = ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0)

    for (let i = 0; i < 9; i += 1) {
      assert.equal(ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0), expected)
    }
  })

  pendingTests.push(differential, edgeCases, properties, deterministic)
}

await Promise.all(pendingTests)
