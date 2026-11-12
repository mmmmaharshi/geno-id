// Shared NIST bit-stream export helpers (Deno mirror of src/scripts/export-bits.ts).
// hexVal and genRawV8 were copied into every src/scripts/deno/export-*.ts;
// this module is the single home. Side-effect free apart from reading
// dist/algo.js like every other Deno export script.
const algo = (await import("../../../dist/algo.js")) as {
  toUuidString: (b: Uint8Array) => string
}
const { toUuidString } = algo

export function hexVal(c: number): number {
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 102) return c - 87
  return 0
}

export function genRawV8(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return toUuidString(bytes)
}
