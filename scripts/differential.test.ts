import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

import type { V8Layout, V8Field, CompiledRawLayout } from "../dist/algo.js"

const root = path.resolve(import.meta.dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)

const { compileRawLayout, interpretRawLayout, getFieldValue, uuidToBytes, DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT } =
  algo as {
    compileRawLayout: (l: V8Layout) => CompiledRawLayout
    interpretRawLayout: (l: V8Layout, raw: Uint8Array, now: number, ctr: number) => string
    getFieldValue: (b: Uint8Array, f: V8Field) => bigint
    uuidToBytes: (u: string) => Uint8Array
    DBKEY_LAYOUT: V8Layout
    MULTITENANT_LAYOUT: V8Layout
    EVENTSOURCING_LAYOUT: V8Layout
  }

const V8_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function rawBytes(v: number[]): Uint8Array {
  const b = new Uint8Array(16)
  for (let i = 0; i < Math.min(v.length, 16); i++) b[i] = v[i]
  return b
}

function generateRaw(): Uint8Array {
  const b = new Uint8Array(16)
  for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0
  return b
}

const EDGE_CASES: Uint8Array[] = [
  rawBytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  rawBytes([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
  rawBytes([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  rawBytes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  rawBytes([0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f]),
  rawBytes([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  rawBytes([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  rawBytes([0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff]),
  rawBytes([0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55]),
  rawBytes([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]),
]

interface LayoutCfg {
  name: string
  layout: V8Layout
  constraints: { field: string; check: (v: number) => boolean }[]
}

const LAYOUTS: LayoutCfg[] = [
  {
    name: "dbkey",
    layout: DBKEY_LAYOUT,
    constraints: [
      { field: "shard", check: (v: number) => v >= 1 && v <= 5 },
      { field: "counter", check: (_v: number) => true },
    ],
  },
  {
    name: "multitenant",
    layout: MULTITENANT_LAYOUT,
    constraints: [
      { field: "tenant", check: (v: number) => v >= 1 && v <= 8 },
      { field: "region", check: (v: number) => v >= 1 && v <= 4 },
    ],
  },
  {
    name: "eventsourcing",
    layout: EVENTSOURCING_LAYOUT,
    constraints: [
      { field: "seq", check: (_v: number) => true },
    ],
  },
]

interface TestCtx {
  rawLayout: CompiledRawLayout
  fieldMap: Record<string, V8Field>
  tsField: V8Field | undefined
  ctrFields: V8Field[]
}

function makeCtx(layout: V8Layout): TestCtx {
  const rawLayout = compileRawLayout(layout)
  const fieldMap: Record<string, V8Field> = {}
  for (const f of layout.fields) fieldMap[f.name] = f
  const tsField = layout.fields.find((f) => f.type === "timestamp-ms" || f.type === "timestamp-us")
  const ctrFields = layout.fields.filter((f) => f.type === "counter")
  return { rawLayout, fieldMap, tsField, ctrFields }
}

for (const lt of LAYOUTS) {
  const ctx = makeCtx(lt.layout)
  const FIXED_TS = 1_700_000_000_000

  test(`${lt.name}: differential — compiled === interpreted for 100k random vectors`, () => {
    const raws: Uint8Array[] = []
    for (let i = 0; i < 100_000; i++) raws.push(generateRaw())
    for (let i = 0; i < raws.length; i++) {
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

  test(`${lt.name}: differential — edge cases`, () => {
    for (const raw of EDGE_CASES) {
      const compiled = ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0)
      const interpreted = interpretRawLayout(lt.layout, raw, FIXED_TS, 0)
      assert.equal(compiled, interpreted)
    }
  })

  test(`${lt.name}: property — valid format + constraints`, () => {
    const raws: Uint8Array[] = []
    for (let i = 0; i < 10_000; i++) raws.push(generateRaw())
    for (let i = 0; i < raws.length; i++) {
      const uuid = ctx.rawLayout.fn(new Uint8Array(raws[i]), FIXED_TS, i)
      if (!V8_RE.test(uuid)) throw new Error(`${lt.name}: invalid format`)
      const b = uuidToBytes(uuid)
      if ((b[6] & 0xf0) !== 0x80) throw new Error(`${lt.name}: version nibble wrong`)
      if ((b[8] & 0xc0) !== 0x80) throw new Error(`${lt.name}: variant bits wrong`)
      for (const { field: fname, check } of lt.constraints) {
        const v = Number(getFieldValue(b, ctx.fieldMap[fname]))
        if (!check(v)) throw new Error(`${lt.name}: field ${fname}=${v} violates constraint`)
      }
    }
  })

  test(`${lt.name}: deterministic`, () => {
    const raw = generateRaw()
    const expected = ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0)
    for (let i = 0; i < 9; i++) {
      assert.equal(ctx.rawLayout.fn(new Uint8Array(raw), FIXED_TS, 0), expected)
    }
  })
}

function bytesHex(b: Uint8Array): string {
  let s = ""
  for (const v of b) s += v.toString(16).padStart(2, "0")
  return s
}
