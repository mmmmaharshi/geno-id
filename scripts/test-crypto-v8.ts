import path from "node:path"
import assert from "node:assert/strict"
import { describe, it } from "node:test"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const { genGenoID } = algo as { genGenoID: () => string }

const V8_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("GenoID — Node.js crypto.randomUUIDv8 test suite", () => {
  it("should return a string of length 36 matching v8 format", () => {
    const uuid = genGenoID()
    assert.strictEqual(typeof uuid, "string")
    assert.strictEqual(uuid.length, 36)
    assert.match(uuid, V8_RE)
  })

  it("should set version nibble 0x8 and variant 0b10", () => {
    const uuid = genGenoID()
    assert.strictEqual(
      Number.parseInt(uuid.slice(14, 16), 16) & 0xf0,
      0x80,
    )
    assert.strictEqual(
      Number.parseInt(uuid.slice(19, 21), 16) & 0b1100_0000,
      0b1000_0000,
    )
  })

  it("should generate unique values across 1000 calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const uuid = genGenoID()
      assert.ok(!seen.has(uuid), `Duplicate UUID generated: ${uuid}`)
      seen.add(uuid)
    }
  })

  it("should return valid v8 format on every call (130 samples)", () => {
    for (let n = 0; n < 130; n++) {
      assert.match(genGenoID(), V8_RE)
    }
  })
})
