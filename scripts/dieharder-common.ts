import path from "node:path"
import fs from "node:fs"
import type { V8Field, V8Layout } from "../dist/algo.js"

// Shared exporter for the dieharder randomness battery. Both
// `export-dieharder.ts` (full 12.5MB samples) and `export-dieharder-smoke.ts`
// (fast local ~25KB samples) drive this with a different `targetBits`.
//
// dieharder wants much larger samples than NIST SP 800-22 (~1.22M bits): a
// short file gets rewound, re-using bits and invalidating p-values. So we
// write packed raw bytes (not an ASCII "0"/"1" string) into a preallocated
// buffer — avoiding a multi-hundred-megabyte intermediate string.

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(path.resolve(root, "dist/algo.js"))
const {
  genV4Native,
  genGenoID,
  toUuidString,
  genStructuredGenoID,
  completeLayout,
  uuidToRandomBits,
} = algo as {
  genV4Native: () => string
  genGenoID: () => string
  toUuidString: (b: Uint8Array) => string
  genStructuredGenoID: (l: V8Layout) => string
  completeLayout: (name: string, core: V8Field[]) => V8Layout
  uuidToRandomBits: (uuid: string, layout: V8Layout) => string
}

function genRawV8(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  return 0
}

const STANDARD_FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff,
]

// Bit-packing sink: accumulates single bits into a preallocated byte buffer.
class BitWriter {
  buf: Uint8Array
  bitPos = 0
  constructor(capacityBits: number) {
    this.buf = new Uint8Array(Math.ceil(capacityBits / 8))
  }
  write(bit: number): void {
    if (bit) {
      const byteIdx = this.bitPos >> 3
      const bitIdx = 7 - (this.bitPos & 7)
      this.buf[byteIdx] |= 1 << bitIdx
    }
    this.bitPos++
  }
  // Trim to a whole number of bytes actually written.
  finish(): Uint8Array {
    return this.buf.subarray(0, Math.floor(this.bitPos / 8))
  }
}

function writeUuidFreeBits(uuid: string, w: BitWriter): void {
  for (let i = 0; i < 16; i++) {
    const idx = HEX_STARTS[i]
    const hi = hexVal(uuid.codePointAt(idx)!)
    const lo = hexVal(uuid.codePointAt(idx + 1)!)
    const v = (hi << 4) | lo
    const mask = STANDARD_FREE_MASK[i]
    for (let b = 7; b >= 0; b--) {
      if (mask & (1 << b)) w.write((v >> b) & 1)
    }
  }
}

async function exportFlat(
  label: string,
  fn: () => string,
  targetBits: number,
): Promise<void> {
  // free bits per standard-layout UUID (excl. version/variant)
  const bitsPerUuid = 122
  const n = Math.ceil(targetBits / bitsPerUuid)
  const w = new BitWriter(n * bitsPerUuid)
  for (let i = 0; i < n; i++) writeUuidFreeBits(fn(), w)
  const packed = w.finish()
  const filePath = path.resolve(root, "dist", `${label}.dieharder.bin`)
  fs.writeFileSync(filePath, packed)
  console.log(
    `Wrote ${(packed.length / 1e6).toFixed(2)} MB (${n.toLocaleString()} UUIDs, ${w.bitPos.toLocaleString()} raw bits) -> ${filePath}`,
  )
}

async function exportStructured(
  label: string,
  layout: V8Layout,
  targetBits: number,
): Promise<void> {
  const randomBitsPerUuid = layout.fields
    .filter((f) => f.type === "random")
    .reduce((s, f) => s + f.length, 0)
  const n = Math.ceil(targetBits / randomBitsPerUuid)
  const w = new BitWriter(n * randomBitsPerUuid)
  for (let i = 0; i < n; i++) {
    const bits = uuidToRandomBits(genStructuredGenoID(layout), layout)
    for (let j = 0; j < bits.length; j++) w.write(bits.codePointAt(j)! - 48)
  }
  const packed = w.finish()
  const filePath = path.resolve(root, "dist", `${label}.dieharder.bin`)
  fs.writeFileSync(filePath, packed)
  console.log(
    `Wrote ${(packed.length / 1e6).toFixed(2)} MB (${n.toLocaleString()} UUIDs, ${w.bitPos.toLocaleString()} raw bits) -> ${filePath}`,
  )
}

export async function runExport(targetBits: number): Promise<void> {
  console.log(
    `Exporting dieharder bitstreams (${(targetBits / 1e6).toFixed(2)}M bits target per generator)...`,
  )
  await exportFlat("v4", genV4Native, targetBits)
  await exportFlat("rawv8", genRawV8, targetBits)
  await exportFlat("genoid", genGenoID, targetBits)

  const dbkey = completeLayout("dbkey", [
    { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
    {
      name: "shard",
      start: 52,
      length: 8,
      type: "shard",
      constraint: { allowed: [1, 2, 3, 4, 5] },
    },
    {
      name: "counter",
      start: 66,
      length: 16,
      type: "counter",
      constraint: { monotonic: true },
    },
  ])
  await exportStructured("struct-dbkey", dbkey, targetBits)

  console.log("Done.")
}
