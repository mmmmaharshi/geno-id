import {
  genPgUuidV8,
  genUlidV8,
  extractRandomBits,
  TIMESTAMPED_FIXED,
} from "../baselines.ts"
import { writeBitsFile } from "./deno-io.ts"

// Export the RANDOM-PAYLOAD bit streams of the UUID-shaped baselines for NIST
// SP 800-22. Timestamped IDs embed a constant timestamp, so we export only the
// random bits (timestamp + version + variant bits stripped) — exactly the part
// whose statistical quality matters. NIST minimum is 1M bits; we emit ~1.55M.
const TARGET_BITS = 1_550_000

async function exportBits(label: string, fn: () => string, fixed: [number, number][]): Promise<void> {
  let bits = ""
  while (bits.length < TARGET_BITS) bits += extractRandomBits(fn(), fixed).join("")
  const file = await writeBitsFile(`${label}.bits.txt`, bits)
  console.log(`${label}: ${bits.length} bits -> ${file}`)
}

await exportBits("baseline-pg", genPgUuidV8, TIMESTAMPED_FIXED)
await exportBits("baseline-ulidv8", genUlidV8, TIMESTAMPED_FIXED)
