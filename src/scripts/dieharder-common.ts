import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
} from "../shared/bitwise.ts"

import { genRawV8, hexVal } from "./shared/export-bits.ts"

import type { V8Layout } from "../../dist/algo.js"

import fs from "node:fs"

import { need } from "../shared/need.ts"
import path from "node:path"

import { pathToFileURL } from "node:url"

// Shared exporter for the dieharder randomness battery. Driven by

// `export-dieharder.ts` with a `targetBits` (full 12.5MB samples, or

// DIEHARDER_BITS=200000 for a fast local smoke).

//

// Dieharder wants much larger samples than NIST SP 800-22 (~1.22M bits): a

// Short file gets rewound, re-using bits and invalidating p-values. So we

// Write packed raw bytes (not an ASCII "0"/"1" string) into a preallocated

// Buffer — avoiding a multi-hundred-megabyte intermediate string.

const __dirname = import.meta.dirname

const root = path.resolve(__dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  genV4Native: () => string

  genGenoID: () => string

  genStructuredGenoID: (l: V8Layout) => string

  uuidToRandomBits: (uuid: string, layout: V8Layout) => string

  DBKEY_LAYOUT: V8Layout
}

const {
  genV4Native,

  genGenoID,

  genStructuredGenoID,

  uuidToRandomBits,

  DBKEY_LAYOUT,
} = algo

const HEX_STARTS = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

const STANDARD_FREE_MASK = [
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 0xFF, 0x3F, 0xFF, 0xFF, 0xFF,

  0xFF, 0xFF, 0xFF, 0xFF,
]

// Bit-packing sink: accumulates single bits into a preallocated byte buffer.

export class BitWriter {
  public buf: Uint8Array

  public bitPos = 0

  public constructor(capacityBits: number) {
    this.buf = new Uint8Array(Math.ceil(capacityBits / 8))
  }

  public write(bit: number): void {
    if (bit) {
      const byteIdx = shiftRightBits(this.bitPos, 3)

      const bitIdx = 7 - andBits(this.bitPos, 7)

      this.buf[byteIdx] = orBits(this.buf[byteIdx], shiftLeftBits(1, bitIdx))
    }

    this.bitPos += 1
  }

  // Trim to a whole number of bytes actually written.

  public finish(): Uint8Array {
    return this.buf.subarray(0, Math.floor(this.bitPos / 8))
  }
}

const writeUuidFreeBits = (uuid: string, w: Readonly<BitWriter>): void => {
  for (let i = 0; i < 16; i += 1) {
    const idx = HEX_STARTS[i]

    const hi = hexVal(need(uuid.codePointAt(idx)))

    const lo = hexVal(need(uuid.codePointAt(idx + 1)))

    const v = orBits(shiftLeftBits(hi, 4), lo)

    const mask = STANDARD_FREE_MASK[i]

    for (let b = 7; b >= 0; b -= 1) {
      if (andBits(mask, shiftLeftBits(1, b))) {
        w.write(andBits(shiftRightBits(v, b), 1))
      }
    }
  }
}

// Free bits per standard-layout UUID (excl. version/variant).

const exportFlat = (
  label: string,

  fn: () => string,

  targetBits: number,

  suffix = "",
): void => {
  const bitsPerUuid = 122

  const n = Math.ceil(targetBits / bitsPerUuid)

  const w = new BitWriter(n * bitsPerUuid)

  for (let i = 0; i < n; i += 1) {
    writeUuidFreeBits(fn(), w)
  }

  const packed = w.finish()

  const filePath = path.resolve(root, "dist", `${label}${suffix}.dieharder.bin`)

  fs.writeFileSync(filePath, packed)

  console.log(
    `Wrote ${(packed.length / 1e6).toFixed(2)} MB (${n.toLocaleString()} UUIDs, ${w.bitPos.toLocaleString()} raw bits) -> ${filePath}`,
  )
}

const exportStructured = (
  label: string,

  layout: Readonly<V8Layout>,

  targetBits: number,

  suffix = "",
): void => {
  const randomBitsPerUuid = layout.fields

    .filter((f) => f.type === "random")

    .reduce((s, f) => s + f.length, 0)

  const n = Math.ceil(targetBits / randomBitsPerUuid)

  const w = new BitWriter(n * randomBitsPerUuid)

  for (let i = 0; i < n; i += 1) {
    const bits = uuidToRandomBits(genStructuredGenoID(layout), layout)

    for (let j = 0; j < bits.length; j += 1) {
      w.write(need(bits.codePointAt(j)) - 48)
    }
  }

  const packed = w.finish()

  const filePath = path.resolve(root, "dist", `${label}${suffix}.dieharder.bin`)

  fs.writeFileSync(filePath, packed)

  console.log(
    `Wrote ${(packed.length / 1e6).toFixed(2)} MB (${n.toLocaleString()} UUIDs, ${w.bitPos.toLocaleString()} raw bits) -> ${filePath}`,
  )
}

export const runExport = async (
  targetBits: number,
  trial = -1,
): Promise<void> => {
  let suffix = ""

  let tag = ""

  if (trial >= 0) {
    suffix = `.trial${trial}`

    tag = ` (trial ${trial})`
  }

  console.log(
    `Exporting dieharder bitstreams${tag} (${(targetBits / 1e6).toFixed(2)}M bits target per generator)...`,
  )

  exportFlat("v4", genV4Native, targetBits, suffix)

  exportFlat("rawv8", genRawV8, targetBits, suffix)

  exportFlat("genoid", genGenoID, targetBits, suffix)

  const dbkey = DBKEY_LAYOUT

  exportStructured("struct-dbkey", dbkey, targetBits, suffix)

  console.log("Done.")

  await Promise.resolve()
}
