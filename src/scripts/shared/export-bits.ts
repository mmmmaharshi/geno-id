import path from "node:path"
// Shared NIST bit-stream export helpers: hex decoding plus the raw-v8
// Generator (CSPRNG bytes in v8 format, no GA). Previously copied into every
// Src/scripts/export-*.ts and src/scripts/dieharder-common.ts; this module is the
// Single home. Side-effect free apart from reading dist/algo.js like every
// Other export script.
import { pathToFileURL } from "node:url"

import {
  andBits,
  orBits,
  shiftLeftBits,
  shiftRightBits,
} from "../../shared/bitwise.ts"
import { need } from "../../shared/need.ts"

const root = path.resolve(import.meta.dirname, "..", "..", "..")

const algo = (await import(
  pathToFileURL(path.join(root, "dist", "algo.js")).href
)) as {
  toUuidString: (b: Uint8Array) => string
}

const { toUuidString } = algo

export const hexVal = (c: number): number => {
  if (c >= 48 && c <= 57) {
    return c - 48
  }

  if (c >= 97 && c <= 102) {
    return c - 87
  }

  return 0
}

export const genRawV8 = (): string => {
  const bytes = new Uint8Array(16)

  crypto.getRandomValues(bytes)

  bytes[6] = orBits(andBits(bytes[6], 0x0f), 0x80)

  bytes[8] = orBits(andBits(bytes[8], 0x3f), 0x80)

  return toUuidString(bytes)
}

export const HEX_STARTS = [
  0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34,
]

export const STANDARD_FREE_MASK = [
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0xff, 0x3f, 0xff, 0xff, 0xff,

  0xff, 0xff, 0xff, 0xff,
]

export const uuidToFreeBits = (uuid: string): string => {
  let bits = ""

  for (let i = 0; i < 16; i += 1) {
    const idx = HEX_STARTS[i]

    const hi = hexVal(need(uuid.codePointAt(idx)))

    const lo = hexVal(need(uuid.codePointAt(idx + 1)))

    const v = orBits(shiftLeftBits(hi, 4), lo)

    const free = andBits(v, STANDARD_FREE_MASK[i])

    for (let b = 0; b < 8; b += 1) {
      if (andBits(STANDARD_FREE_MASK[i], shiftLeftBits(1, b))) {
        let bit = "0"

        if (andBits(shiftRightBits(free, b), 1)) {
          bit = "1"
        }

        bits += bit
      }
    }
  }

  return bits
}
