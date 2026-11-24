/// <reference types="node" />
import { andBits, shiftRightUnsignedBits } from "../shared/bitwise.ts"

import type { V8Field } from "../../dist/algo.js"

import assert from "node:assert/strict"

import { fromAny } from "@total-typescript/shoehorn"

import { need } from "../shared/need.ts"

import path from "node:path"

import { pathToFileURL } from "node:url"
import { test } from "node:test"

const nullValue: null = JSON.parse("null") as null

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

const algoTyped = algo as {
  compileLayout: (
    l: ReadonlyV8Layout,
    poolSize?: number,
  ) => { source: string; fn: () => string }

  getFieldValue: (b: Readonly<Uint8Array>, f: ReadonlyV8Field) => bigint

  uuidToBytes: (u: string) => Uint8Array

  DBKEY_LAYOUT: ReadonlyV8Layout

  MULTITENANT_LAYOUT: ReadonlyV8Layout

  EVENTSOURCING_LAYOUT: ReadonlyV8Layout

  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void

  configureRandom: (fn: ((buf: Uint8Array) => void) | null) => void
}

const {
  compileLayout,

  getFieldValue,

  uuidToBytes,

  DBKEY_LAYOUT,

  MULTITENANT_LAYOUT,

  EVENTSOURCING_LAYOUT,

  createSeededRandom,

  configureRandom,
} = algoTyped

const layouts: [string, ReadonlyV8Layout][] = [
  ["dbkey", DBKEY_LAYOUT],

  ["multitenant", MULTITENANT_LAYOUT],

  ["eventsourcing", EVENTSOURCING_LAYOUT],
]

void test("compileLayout produces valid UUID v8 format for all layouts", () => {
  for (const [name, layout] of layouts) {
    const compiled = compileLayout(layout)

    const uuid = compiled.fn()

    assert.equal(
      uuid.length,
      36,
      `${name}: expected 36-char UUID, got "${uuid}"`,
    )

    assert.match(
      uuid,

      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,

      `${name}: invalid v8 format: "${uuid}"`,
    )
  }
})

void test("compileLayout dbkey: timestamp field is recent", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)

  const uuid = compiled.fn()

  const b = uuidToBytes(uuid)

  const tsField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp"))

  const ts = getFieldValue(b, tsField)

  const now = BigInt(Date.now())

  const diff = Number(now - ts)

  assert.ok(diff >= 0 && diff < 5000, `timestamp diff ${diff}ms too large`)
})

void test("compileLayout dbkey: shard constraint [1..5] enforced", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)

  for (let i = 0; i < 200; i += 1) {
    const uuid = compiled.fn()

    const b = uuidToBytes(uuid)

    const shardField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "shard"))

    const shard = Number(getFieldValue(b, shardField))

    assert.ok(
      shard >= 1 && shard <= 5,
      `shard ${shard} out of [1,5] for "${uuid}"`,
    )
  }
})

void test("compileLayout multitenant: tenant [1..8] + region [1..4] enforced", () => {
  const compiled = compileLayout(MULTITENANT_LAYOUT)

  const tField = need(
    MULTITENANT_LAYOUT.fields.find((f) => f.name === "tenant"),
  )

  const rField = need(
    MULTITENANT_LAYOUT.fields.find((f) => f.name === "region"),
  )

  for (let i = 0; i < 200; i += 1) {
    const uuid = compiled.fn()

    const b = uuidToBytes(uuid)

    const tenant = Number(getFieldValue(b, tField))

    const region = Number(getFieldValue(b, rField))

    assert.ok(
      tenant >= 1 && tenant <= 8,
      `tenant ${tenant} out of [1,8] for "${uuid}"`,
    )

    assert.ok(
      region >= 1 && region <= 4,
      `region ${region} out of [1,4] for "${uuid}"`,
    )
  }
})

void test("compileLayout eventsourcing: stream is non-zero", () => {
  const compiled = compileLayout(EVENTSOURCING_LAYOUT)

  const sField = need(
    EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "stream"),
  )

  for (let i = 0; i < 100; i += 1) {
    const uuid = compiled.fn()

    const b = uuidToBytes(uuid)

    const stream = Number(getFieldValue(b, sField))

    assert.ok(stream > 0, `stream ${stream} should be > 0`)
  }
})

void test("compileLayout dbkey: counter monotonicity within generation batch", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)

  const ctrField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "counter"))

  let prev = -1

  for (let i = 0; i < 500; i += 1) {
    const uuid = compiled.fn()

    const b = uuidToBytes(uuid)

    const ctr = Number(getFieldValue(b, ctrField))

    assert.ok(
      ctr > prev || (ctr === 0 && prev === 0xFF_FF),

      `counter regressed: ${prev} → ${ctr} at call ${i}`,
    )

    prev = ctr
  }
})

void test("compileLayout applies deterministic CSPRNG bytes to every declared field", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)

  const shardField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "shard"))

  const counterField = need(
    DBKEY_LAYOUT.fields.find((f) => f.name === "counter"),
  )

  const timestampField = need(
    DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp"),
  )

  const fixedTime = 1_700_000_000_000

  const originalNow = Date.now

  const deterministicBytes = new Uint8Array(16)

  crypto.getRandomValues(deterministicBytes)

  try {
    Date.now = (): number => fixedTime

    configureRandom((buf) => {
      buf.set(deterministicBytes.subarray(0, buf.length))
    })

    const uuid = compiled.fn()

    const bytes = uuidToBytes(uuid)

    const timestamp = Number(getFieldValue(bytes, timestampField))

    const shard = Number(getFieldValue(bytes, shardField))

    const counter = Number(getFieldValue(bytes, counterField))

    assert.equal(timestamp, fixedTime)

    const allowed = [1, 2, 3, 4, 5]

    const rawShard =
      andBits(deterministicBytes[6], 0x0F) * 16 +
      shiftRightUnsignedBits(andBits(deterministicBytes[7], 0xF0), 4)

    assert.equal(shard, allowed[rawShard % allowed.length])

    const rawCounter =
      andBits(deterministicBytes[8], 0x3F) * 1024 +
      deterministicBytes[9] * 4 +
      shiftRightUnsignedBits(deterministicBytes[10], 6)

    assert.equal(counter, rawCounter % 32_768)
  } finally {
    Date.now = originalNow

    configureRandom(nullValue)
  }
})

void test("compileLayout source exports valid JS", () => {
  for (const [name, layout] of layouts) {
    const compiled = compileLayout(layout)

    assert.ok(typeof compiled.source === "string")

    assert.ok(
      compiled.source.includes("cr.getRandomValues"),

      `${name}: missing getRandomValues call in source`,
    )

    assert.ok(
      compiled.source.includes("b[6]=(b[6]&0x0f)|0x80"),

      `${name}: missing version nibble in source`,
    )

    assert.ok(
      compiled.source.length < 20_000,

      `${name}: source too long (${compiled.source.length})`,
    )
  }

  assert.match(
    compileLayout(DBKEY_LAYOUT, Number.NaN).fn(),

    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  )

  assert.throws(() => compileLayout(DBKEY_LAYOUT, 1.5), RangeError)
})

void test("configureRandom rejects a non-function CSPRNG instead of emitting IDs", () => {
  assert.throws(
    () => {
      configureRandom(fromAny<(buf: Uint8Array) => void, unknown>(123))
    },

    TypeError,
  )
})

void test("compileLayout deterministic: same seed produces same output", () => {
  const layout = DBKEY_LAYOUT

  const runA = compileLayout(layout).fn

  const runB = compileLayout(layout).fn

  const shardField = need(layout.fields.find((f) => f.name === "shard"))

  const counterField = need(layout.fields.find((f) => f.name === "counter"))

  const timestampField = need(layout.fields.find((f) => f.name === "timestamp"))

  const wallStart = Date.now()

  const idsA: string[] = []

  try {
    configureRandom(createSeededRandom(0xDE_AD, 0xBE_EF))

    for (let i = 0; i < 100; i += 1) {
      idsA.push(runA())
    }

    for (const uuid of idsA) {
      assert.match(
        uuid,
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )

      const bytes = uuidToBytes(uuid)

      const shard = Number(getFieldValue(bytes, shardField))

      assert.ok(shard >= 1 && shard <= 5, `shard ${shard} out of range`)
    }

    configureRandom(createSeededRandom(0xDE_AD, 0xBE_EF))

    for (let i = 0; i < 100; i += 1) {
      const bytesA = uuidToBytes(idsA[i])

      const bytesB = uuidToBytes(runB())

      const timestampA = Number(getFieldValue(bytesA, timestampField))

      const timestampB = Number(getFieldValue(bytesB, timestampField))

      const wallMs = Date.now() - wallStart

      assert.ok(
        Math.abs(timestampA - timestampB) <= wallMs + 1000,

        `timestamp diff ${Math.abs(timestampA - timestampB)}ms > elapsed ${wallMs}ms + 1000ms`,
      )

      assert.equal(
        Number(getFieldValue(bytesA, shardField)),
        Number(getFieldValue(bytesB, shardField)),
      )

      assert.equal(
        Number(getFieldValue(bytesA, counterField)),
        Number(getFieldValue(bytesB, counterField)),
      )

      for (let byte = 6; byte < 16; byte += 1) {
        if (byte === 6) {
          assert.equal(andBits(bytesA[byte], 0x0F), andBits(bytesB[byte], 0x0F))
        } else if (byte === 8) {
          assert.equal(andBits(bytesA[byte], 0x3F), andBits(bytesB[byte], 0x3F))
        } else {
          assert.equal(bytesA[byte], bytesB[byte])
        }
      }
    }
  } finally {
    configureRandom(nullValue)
  }
})
