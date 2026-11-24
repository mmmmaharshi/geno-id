import { andBits, orBits } from "../../shared/bitwise.ts"
// Shared NIST bit-stream export helpers: hex decoding plus the raw-v8

// Generator (CSPRNG bytes in v8 format, no GA). Previously copied into every

// Src/scripts/export-*.ts and src/scripts/dieharder-common.ts; this module is the

// Single home. Side-effect free apart from reading dist/algo.js like every

// Other export script.

import path from "node:path"

import { pathToFileURL } from "node:url"

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

  bytes[6] = orBits(andBits(bytes[6], 0x0F), 0x80)

  bytes[8] = orBits(andBits(bytes[8], 0x3F), 0x80)

  return toUuidString(bytes)
}
