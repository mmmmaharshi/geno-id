// P1 — Head-to-head: pg_uuid_v8 (closest prior art) vs GenoID-structured.
//
// The literature review (docs/literature-review.md) identifies pg_uuid_v8
// (ineron, 2026) as the closest prior art to GenoID's declarative v8 layout,
// but the existing baselines.ts only exposes it as a generator function and
// never runs it through the real NIST + throughput harness. This script closes
// that gap: it benchmarks pg_uuid_v8 and GenoID-structured through the SAME
// seams (benchSync, uuidToRandomBits, collisionTest) so the comparison is
// apples-to-apples.
//
// Reuses:
//  - genPgUuidV8 / extractPgUuidV8Timestamp from baselines.ts
//  - genStructuredGenoID / DBKEY_LAYOUT / uuidToRandomBits from algo.ts
//  - benchSync / collisionTest / birthdayBound50 from bench-core.ts

import { benchSync, collisionTest, birthdayBound50 } from "../dist/bench-core.js"
import {
  genPgUuidV8,
  extractPgUuidV8Timestamp,
  uuidToBytes,
} from "./baselines.js"
import {
  genStructuredGenoID,
  DBKEY_LAYOUT,
  uuidToRandomBits,
} from "../dist/algo.js"
import { writeFileSync, mkdirSync } from "node:fs"

const N_SYNC = 200_000
const N_COLL = 2_000_000

function bitsFromUuidNs(uuid: string): string {
  // pg_uuid_v8 embeds a 48-bit encrypted timestamp in bits 0..47 (near-constant
  // within a run) and 80 CSPRNG random bits in the tail. To measure UNIFORMITY
  // of the genuinely-random region (apples-to-apples with GenoID-structured's
  // random fields), we keep only the 80 random bits: bytes 6 low nibble (4),
  // byte 7 (8), bytes 8 low 6 bits (6), bytes 9..15 (56) = 74 bits, plus the
  // 6 version/variant-exempt bits are excluded. We expose the 80 random tail
  // bits (positions 52..63 and 66..127) only.
  const b = uuidToBytes(uuid)
  let s = ""
  for (let j = 0; j < 16; j++) s += b[j].toString(2).padStart(8, "0")
  const chars = [...s]
  // keep only random tail: 52..63 and 66..127; drop 0..51 (timestamp) + 64..65 (variant)
  for (let i = 0; i < 128; i++) {
    if (i < 52 || (i >= 64 && i <= 65)) chars[i] = ""
  }
  return chars.join("")
}

function main(): void {
  console.log("=== P1: pg_uuid_v8 (prior art) vs GenoID-structured ===\n")

  // ---- Throughput (E6-style) ----
  const rV4 = benchSync(() => crypto.randomUUID(), N_SYNC)
  const rGeno = benchSync(() => genStructuredGenoID(DBKEY_LAYOUT), N_SYNC)
  const rPg = benchSync(() => genPgUuidV8(), N_SYNC)

  console.log("Throughput (ops/sec):")
  console.log(`  v4 native:            ${rV4.opsPerSec.toFixed(0)}`)
  console.log(`  GenoID-structured:    ${rGeno.opsPerSec.toFixed(0)}  (${(rV4.opsPerSec / rGeno.opsPerSec).toFixed(1)}x slower vs v4)`)
  console.log(`  pg_uuid_v8:           ${rPg.opsPerSec.toFixed(0)}  (${(rV4.opsPerSec / rPg.opsPerSec).toFixed(1)}x slower vs v4)`)

  // ---- Composition correctness (E1-style) ----
  const N = 500_000
  let tsFail = 0
  let vioFail = 0
  for (let t = 0; t < N; t++) {
    const u = genPgUuidV8()
    const b = uuidToBytes(u)
    const version = (b[6] >> 4) & 0x0f
    const variant = (b[8] >> 6) & 0x03
    if (version !== 0x4 || variant !== 0x2) vioFail++
    // round-trip timestamp
    const ts1 = extractPgUuidV8Timestamp(u)
    const ts2 = extractPgUuidV8Timestamp(genPgUuidV8(ts1))
    if (ts1 !== ts2) tsFail++
  }
  console.log("\nComposition (pg_uuid_v8):")
  console.log(`  version/variant violations: ${vioFail}  (expected 0)`)
  console.log(`  timestamp round-trip mismatches: ${tsFail}  (expected 0)`)

  // ---- Collision + uniformity (E3/E4-style) ----
  const cGeno = collisionTest(() => genStructuredGenoID(DBKEY_LAYOUT), N_COLL)
  const cPg = collisionTest(() => genPgUuidV8(), N_COLL)
  console.log("\nCollisions:")
  console.log(`  GenoID-structured (n=${N_COLL}): ${cGeno}  (bound 50% @122b: ${birthdayBound50(122).toExponential(2)})`)
  console.log(`  pg_uuid_v8        (n=${N_COLL}): ${cPg}`)

  // Uniformity: ones-density on payload bits
  const M = 50_000
  const bitsGeno = uuidToRandomBits(genStructuredGenoID(DBKEY_LAYOUT), DBKEY_LAYOUT)
  const nBits = bitsGeno.length
  const onesG = new Array<number>(nBits).fill(0)
  const onesP = new Array<number>(nBits).fill(0)
  for (let i = 0; i < M; i++) {
    const bg = uuidToRandomBits(genStructuredGenoID(DBKEY_LAYOUT), DBKEY_LAYOUT)
    const bp = bitsFromUuidNs(genPgUuidV8())
    for (let j = 0; j < nBits; j++) {
      if (bg[j] === "1") onesG[j]++
      if (bp[j] === "1") onesP[j]++
    }
  }
  const devG = Math.max(...onesG.map((x) => Math.abs(x / M - 0.5)))
  const devP = Math.max(...onesP.map((x) => Math.abs(x / M - 0.5)))
  console.log("\nUniformity (max |ones-density - 0.5| over payload bits):")
  console.log(`  GenoID-structured: ${devG.toFixed(4)}`)
  console.log(`  pg_uuid_v8:        ${devP.toFixed(4)}`)

  // ---- NIST bit export (consumed by nist-bridge.py) ----
  const dist = "dist"
  mkdirSync(dist, { recursive: true })
  const outG: string[] = []
  const outP: string[] = []
  const N_NIST = 1_000_000
  for (let i = 0; i < N_NIST; i++) {
    outG.push(uuidToRandomBits(genStructuredGenoID(DBKEY_LAYOUT), DBKEY_LAYOUT))
    outP.push(bitsFromUuidNs(genPgUuidV8()))
  }
  // Write separate files for nist-bridge.py consumption.
  writeFileSync(`${dist}/struct-dbkey-p1.bits.txt`, outG.join("\n"))
  writeFileSync(`${dist}/pg-uuid-v8.bits.txt`, outP.join("\n"))
  console.log(`\nExported ${N_NIST} UUIDs each -> dist/struct-dbkey-p1.bits.txt, dist/pg-uuid-v8.bits.txt`)

  // ---- Summary table ----
  console.log("\n=== HEAD-TO-HEAD SUMMARY ===")
  console.log("metric                  | GenoID-structured | pg_uuid_v8")
  console.log("------------------------|-------------------|-----------")
  console.log(`ops/sec                 | ${rGeno.opsPerSec.toFixed(0).padStart(17)} | ${rPg.opsPerSec.toFixed(0).padStart(9)}`)
  console.log(`collisions (n=${N_COLL})     | ${String(cGeno).padStart(17)} | ${String(cPg).padStart(9)}`)
  console.log(`uniformity max-dev      | ${devG.toFixed(4).padStart(17)} | ${devP.toFixed(4).padStart(9)}`)
  console.log(`ts/field round-trip OK  | ${"n/a (declarative)".padStart(17)} | ${(tsFail === 0).toString().padStart(9)}`)
}

main()
