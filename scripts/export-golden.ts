import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)
const {
  configureRandom,
  createSeededRandom,
  resetSeededState,
  genStructuredGenoID,
  genStructuredGenoIDSingleParent,
  compileLayout,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} = algo as {
  configureRandom: (fn: ((buf: Uint8Array) => void) | null) => void
  createSeededRandom: (s0: number, s1: number) => (buf: Uint8Array) => void
  resetSeededState: () => void
  genStructuredGenoID: (layout: unknown) => string
  genStructuredGenoIDSingleParent: (layout: unknown) => string
  compileLayout: (layout: unknown) => { source: string; fn: () => string }
  DBKEY_LAYOUT: unknown
  MULTITENANT_LAYOUT: unknown
  EVENTSOURCING_LAYOUT: unknown
}

const N = 1000
const SEED0 = 0xdeadbeef
const SEED1 = 0x4f15f00d
const FIXED_TIME_MS = 1_700_000_000_000

type Layout = unknown

function emit(layout: Layout, name: string, gen: (l: Layout) => string, label: string): void {
  resetSeededState()
  configureRandom(createSeededRandom(SEED0, SEED1))
  const origNow = Date.now
  Date.now = () => FIXED_TIME_MS
  const lines: string[] = []
  for (let i = 0; i < N; i++) lines.push(gen(layout))
  Date.now = origNow
  const content = lines.join("\n") + "\n"
  const dir = path.resolve(root, "golden")
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.resolve(dir, `${name}.txt`)
  fs.writeFileSync(filePath, content)
  console.log(`  ${label}: wrote ${N} UUIDs to golden/${name}.txt`)
}

// Emit compiled golden vectors. The compiled function draws 16 CSPRNG bytes per
// UUID — a different consumption pattern than the pool-based interpreted path
// (34-byte STRUCT_ENTRY stride + separate _csprngBuf), so these ARE NOT
// byte-for-byte comparable to the interpreted golden vectors. They serve as a
// deterministic check that the compiled field-assembly logic is stable across
// runs (same input bytes → same UUID) and are structurally validatable.
function emitCompiled(layout: Layout, name: string, label: string): void {
  const compiled = compileLayout(layout)
  const seededFill = createSeededRandom(SEED0, SEED1)
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
  // Reuse the same seeded generator for both the pool-based interpreted path
  // (above) and this compiled path. The consumption rates differ (16 bytes vs
  // STRUCT_ENTRY), so the Nth UUID will differ — what matters is that the
  // output is deterministic, structurally valid, and the field-assembly logic
  // matches the interpreted layout specification.
  const cfn = factory(algo.HEX8, algo.wordTable(), cr)
  const origNow = Date.now
  Date.now = () => FIXED_TIME_MS
  const lines: string[] = []
  for (let i = 0; i < N; i++) lines.push(cfn())
  Date.now = origNow
  const content = lines.join("\n") + "\n"
  const dir = path.resolve(root, "golden")
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.resolve(dir, `compiled-${name}.txt`)
  fs.writeFileSync(filePath, content)
  console.log(`  ${label}: wrote ${N} UUIDs to golden/compiled-${name}.txt`)
}

console.log("=== Golden vector export ===")
console.log(`seed: (${SEED0}, ${SEED1}), n=${N}, fixed-time=${FIXED_TIME_MS}`)

emit(DBKEY_LAYOUT, "dbkey-two-parent", genStructuredGenoID, "dbkey (two-parent)")
emit(DBKEY_LAYOUT, "dbkey-single-parent", genStructuredGenoIDSingleParent, "dbkey (single-parent)")
emit(MULTITENANT_LAYOUT, "multitenant-two-parent", genStructuredGenoID, "multitenant (two-parent)")
emit(MULTITENANT_LAYOUT, "multitenant-single-parent", genStructuredGenoIDSingleParent, "multitenant (single-parent)")
emit(EVENTSOURCING_LAYOUT, "eventsourcing-two-parent", genStructuredGenoID, "eventsourcing (two-parent)")
emit(EVENTSOURCING_LAYOUT, "eventsourcing-single-parent", genStructuredGenoIDSingleParent, "eventsourcing (single-parent)")

console.log("\n=== Compiled golden vectors (different CSPRNG consumption) ===")
emitCompiled(DBKEY_LAYOUT, "dbkey", "dbkey compiled")
emitCompiled(MULTITENANT_LAYOUT, "multitenant", "multitenant compiled")
emitCompiled(EVENTSOURCING_LAYOUT, "eventsourcing", "eventsourcing compiled")

configureRandom(null)
console.log("=== Done ===")
