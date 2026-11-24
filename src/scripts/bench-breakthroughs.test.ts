import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist/algo.js")).href
)) as {
  deriveWorkerId: (ipv4: string) => number
  splitMsFrac: (floatMs: number) => { frac: number; ms: number }
  stegoSeal: (ms: number, seed: string) => Uint8Array
  stegoOpen: (sealed: Uint8Array, seed: string) => number
  experimentalIntegrityTag: (data: Uint8Array, key: Uint8Array) => number
  experimentalIntegrityVerify: (
    data: Uint8Array,
    key: Uint8Array,
    tag: number
  ) => boolean
}

void test("deriveWorkerId uses last 16 bits of IPv4", () => {
  assert.equal(algo.deriveWorkerId("10.0.3.4"), 3 * 256 + 4)
  assert.equal(algo.deriveWorkerId("192.168.0.1"), 1)
  assert.throws(() => algo.deriveWorkerId("not-an-ip"), RangeError)
  assert.throws(() => algo.deriveWorkerId("10.0.0"), RangeError)
})

void test("splitMsFrac separates ms and 12-bit fraction", () => {
  const { frac, ms } = algo.splitMsFrac(1_700_000_000_000.5)
  assert.equal(ms, 1_700_000_000_000)
  assert.ok(frac >= 2000 && frac <= 2100)
  const zero = algo.splitMsFrac(1000)
  assert.equal(zero.ms, 1000)
  assert.equal(zero.frac, 0)
})

void test("stego seal/open round-trips 48-bit ms", () => {
  const ms = 1_700_000_000_000
  const sealed = algo.stegoSeal(ms, "test-seed")
  assert.equal(sealed.length, 6)
  assert.equal(algo.stegoOpen(sealed, "test-seed"), ms % 2 ** 48)
  const wrong = algo.stegoOpen(sealed, "other-seed")
  assert.notEqual(wrong, ms % 2 ** 48)
})

void test("experimental integrity tag verifies with key", () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const key = new Uint8Array([9, 9, 9, 9])
  const tag = algo.experimentalIntegrityTag(data, key)
  assert.equal(algo.experimentalIntegrityVerify(data, key, tag), true)
  const tampered = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9])
  assert.equal(algo.experimentalIntegrityVerify(tampered, key, tag), false)
  assert.equal(
    algo.experimentalIntegrityVerify(data, new Uint8Array([1, 1, 1, 1]), tag),
    false
  )
})
