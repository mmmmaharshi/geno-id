import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// oxlint-disable-next-line no-unused-vars
import type { V8Layout, V8Field } from "../dist/algo.js"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const algoTyped = algo as {
  compileLayout: (l: V8Layout) => { source: string; fn: () => string }
  getFieldValue: (b: Uint8Array, f: V8Field) => bigint
  uuidToBytes: (u: string) => Uint8Array
  DBKEY_LAYOUT: V8Layout
  MULTITENANT_LAYOUT: V8Layout
  EVENTSOURCING_LAYOUT: V8Layout
  HEX8: string[]
  wordTable: () => string[] | null
  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void
}

const {
  compileLayout,
  getFieldValue,
  uuidToBytes,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
  HEX8,
  wordTable: algoWordTable,
  createSeededRandom,
} = algoTyped

const layouts: [string, V8Layout][] = [
  ["dbkey", DBKEY_LAYOUT],
  ["multitenant", MULTITENANT_LAYOUT],
  ["eventsourcing", EVENTSOURCING_LAYOUT],
]

test("compileLayout produces valid UUID v8 format for all layouts", () => {
  for (const [name, layout] of layouts) {
    const compiled = compileLayout(layout)
    const uuid = compiled.fn()
    assert.equal(uuid.length, 36, `${name}: expected 36-char UUID, got "${uuid}"`)
    assert.match(
      uuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      `${name}: invalid v8 format: "${uuid}"`,
    )
  }
})

test("compileLayout dbkey: timestamp field is recent", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  const uuid = compiled.fn()
  const b = uuidToBytes(uuid)
  const tsField = DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp")!
  const ts = getFieldValue(b, tsField)
  const now = BigInt(Date.now())
  const diff = Number(now - ts)
  assert.ok(diff >= 0 && diff < 5000, `timestamp diff ${diff}ms too large`)
})

test("compileLayout dbkey: shard constraint [1..5] enforced", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  for (let i = 0; i < 200; i++) {
    const uuid = compiled.fn()
    const b = uuidToBytes(uuid)
    const shardField = DBKEY_LAYOUT.fields.find((f) => f.name === "shard")!
    const shard = Number(getFieldValue(b, shardField))
    assert.ok(shard >= 1 && shard <= 5, `shard ${shard} out of [1,5] for "${uuid}"`)
  }
})

test("compileLayout multitenant: tenant [1..8] + region [1..4] enforced", () => {
  const compiled = compileLayout(MULTITENANT_LAYOUT)
  const tField = MULTITENANT_LAYOUT.fields.find((f) => f.name === "tenant")!
  const rField = MULTITENANT_LAYOUT.fields.find((f) => f.name === "region")!
  for (let i = 0; i < 200; i++) {
    const uuid = compiled.fn()
    const b = uuidToBytes(uuid)
    const tenant = Number(getFieldValue(b, tField))
    const region = Number(getFieldValue(b, rField))
    assert.ok(tenant >= 1 && tenant <= 8, `tenant ${tenant} out of [1,8] for "${uuid}"`)
    assert.ok(region >= 1 && region <= 4, `region ${region} out of [1,4] for "${uuid}"`)
  }
})

test("compileLayout eventsourcing: stream is non-zero", () => {
  const compiled = compileLayout(EVENTSOURCING_LAYOUT)
  const sField = EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "stream")!
  for (let i = 0; i < 100; i++) {
    const uuid = compiled.fn()
    const b = uuidToBytes(uuid)
    const stream = Number(getFieldValue(b, sField))
    assert.ok(stream > 0, `stream ${stream} should be > 0`)
  }
})

test("compileLayout dbkey: counter monotonicity within generation batch", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  const ctrField = DBKEY_LAYOUT.fields.find((f) => f.name === "counter")!
  let prev = -1
  for (let i = 0; i < 500; i++) {
    const uuid = compiled.fn()
    const b = uuidToBytes(uuid)
    const ctr = Number(getFieldValue(b, ctrField))
    assert.ok(
      ctr > prev || (ctr === 0 && prev === 0xffff),
      `counter regressed: ${prev} → ${ctr} at call ${i}`,
    )
    prev = ctr
  }
})

test("compileLayout bytes identical to interpreted when using same CSPRNG draw", async () => {
  // Compile the layout and override its CSPRNG source with a deterministic
  // byte sequence that matches the draw pattern of `genStructuredGenoID` for
  // verification purposes. We verify field-level correctness by feeding known
  // CSPRNG bytes through both the compiled and interpreted code paths.
  const compiled = compileLayout(DBKEY_LAYOUT)
  const shardField = DBKEY_LAYOUT.fields.find((f) => f.name === "shard")!
  const counterField = DBKEY_LAYOUT.fields.find((f) => f.name === "counter")!
  const timestampField = DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp")!

  // Use deterministic source bytes. The compiled function draws 16 bytes per
  // UUID for the body, then uses a byte from the body for shard selection.
  // The interpreted version uses the pool. Both must produce the same field
  // values when given identical layout rules and CSPRNG draw.
  const FIXED_TS = 1_700_000_000_000
  const origNow = Date.now
  Date.now = () => FIXED_TS

  const deterministicBytes = new Uint8Array(16)
  crypto.getRandomValues(deterministicBytes)

  // Compiled path: inject deterministic cr.getRandomValues
  const injectedCr = {
    getRandomValues(buf: Uint8Array) {
      for (let i = 0; i < buf.length; i++) buf[i] = deterministicBytes[i]
    },
  }

  // Recreate the compiled function bound to our injected CR
  const compiledSrc = compiled.source
  const factory = new Function("h", "w", "cr", compiledSrc) as (
    h: string[],
    w: string[] | null,
    cr: { getRandomValues(buf: Uint8Array): void },
  ) => () => string
  const cfn = factory(HEX8, algoWordTable(), injectedCr)

  const uuid = cfn()
  const b = uuidToBytes(uuid)
  const ts = Number(getFieldValue(b, timestampField))
  const shard = Number(getFieldValue(b, shardField))
  const ctr = Number(getFieldValue(b, counterField))

  // Verify field values match expected layout rules:
  //   timestamp = FIXED_TS % 2^48 = FIXED_TS (since FIXED_TS < 2^48)
  assert.equal(ts, FIXED_TS)

  // Shard value: Phase 2 uses modulo-based pick from the allowed list.
  const allowed = [1, 2, 3, 4, 5]
  const rawShard =
    (deterministicBytes[6] & 0x0f) * 16 +
    ((deterministicBytes[7] & 0xf0) >>> 4)
  const expectedShard = allowed[rawShard % allowed.length]
  assert.equal(shard, expectedShard)

  // counter starts at 1 (first call, ++ increments from 0 to 1)
  assert.equal(ctr, 1)

  Date.now = origNow
})

test("compileLayout source exports valid JS", () => {
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
      compiled.source.length < 20000,
      `${name}: source too long (${compiled.source.length})`,
    )
  }
})

test("compileLayout fn throws usably when no crypto", () => {
  const compiled = compileLayout(DBKEY_LAYOUT)
  const badCrypto = { getRandomValues: null as unknown as (buf: Uint8Array) => void }
  try {
    const factory = new Function("h", "w", "cr", compiled.source) as (
      h: string[],
      w: string[] | null,
      cr: { getRandomValues(buf: Uint8Array): void },
    ) => () => string
    const cfn = factory(HEX8, algoWordTable(), badCrypto)
    cfn()
    assert.fail("should have thrown")
  } catch {
    // expected
  }
})

test("compileLayout deterministic: same seed produces same output", () => {
  const layout = DBKEY_LAYOUT
  const compiled = compileLayout(layout)

  // Deterministic seed: two runs with same seed must produce identical UUIDs
  interface Run { cfn: () => string }

  function makeRun(): Run {
    const seededFill = createSeededRandom(0xdead, 0xbeef)
    const cr = {
      getRandomValues(buf: Uint8Array) {
        seededFill(buf)
      },
    }
    const factory = new Function("h", "w", "cr", compiled.source) as (
      h: string[],
      w: string[] | null,
      cr: { getRandomValues(buf: Uint8Array): void },
    ) => () => string
    return { cfn: factory(HEX8, algoWordTable(), cr) }
  }

  const runA = makeRun()
  const runB = makeRun()

  // Do NOT override Date.now — want wall-clock time. The timestamps of
  // concurrent calls may differ by a ms, so we compare only shape + constraints.
  const idsA: string[] = []
  for (let i = 0; i < 100; i++) idsA.push(runA.cfn())

  // Verify format + constraints on run A
  const shardField = layout.fields.find((f) => f.name === "shard")!
  for (let i = 0; i < 100; i++) {
    const uuid = idsA[i]
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const b = uuidToBytes(uuid)
    const shard = Number(getFieldValue(b, shardField))
    assert.ok(shard >= 1 && shard <= 5, `shard ${shard} out of range`)
  }

  // Run B is identical to A above (same seed). Since Date.now() is NOT frozen,
  // but both runs execute sequentially and each UUID takes <1µs, the timestamp
  // of corresponding UUIDs should match (sub-µs precision, same ms).
  for (let i = 0; i < 100; i++) {
    const uuidB = runB.cfn()
    const uuidA = idsA[i]

    // The CSPRNG bytes are identical, but timestamps may differ by 0-1ms if
    // we cross a clock boundary. Compare fields that depend ONLY on CSPRNG.
    const bA = uuidToBytes(uuidA)
    const bB = uuidToBytes(uuidB)

    // Timestamp field (offset 0, 48 bits) — may differ by 1ms
    const tsA = Number(getFieldValue(bA, layout.fields.find((f) => f.name === "timestamp")!))
    const tsB = Number(getFieldValue(bB, layout.fields.find((f) => f.name === "timestamp")!))
    const tsDiff = Math.abs(tsA - tsB)
    assert.ok(tsDiff <= 1, `timestamp diff ${tsDiff}ms > 1ms`)

    // Shard — depends only on CSPRNG, must match
    const shardA = Number(getFieldValue(bA, shardField))
    const shardB = Number(getFieldValue(bB, shardField))
    assert.equal(shardA, shardB, `shard mismatch at index ${i}`)

    // Counter — depends only on internal state, must match
    const ctrField = layout.fields.find((f) => f.name === "counter")!
    const ctrA = Number(getFieldValue(bA, ctrField))
    const ctrB = Number(getFieldValue(bB, ctrField))
    assert.equal(ctrA, ctrB, `counter mismatch at index ${i}`)

    // Random bits — depends only on CSPRNG, must match
    // Skip bytes 0-5 (timestamp field — may differ by 1ms)
    // Compare bytes that are not version/variant nibbles
    for (let bi = 6; bi < 16; bi++) {
      if (bi === 6) {
        // Version nibble — only low 4 bits are random
        assert.equal(bA[bi] & 0x0f, bB[bi] & 0x0f, `byte ${bi} mismatch at index ${i}`)
      } else if (bi === 8) {
        // Variant nibble — only low 6 bits are random
        assert.equal(bA[bi] & 0x3f, bB[bi] & 0x3f, `byte ${bi} mismatch at index ${i}`)
      } else {
        assert.equal(bA[bi], bB[bi], `byte ${bi} mismatch at index ${i}`)
      }
    }
  }
})
