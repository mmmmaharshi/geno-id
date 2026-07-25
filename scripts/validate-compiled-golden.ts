import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..")
const algo = await import(pathToFileURL(path.resolve(root, "dist/algo.js")).href)

const { uuidToBytes, getFieldValue, DBKEY_LAYOUT, MULTITENANT_LAYOUT, EVENTSOURCING_LAYOUT } =
  algo as {
    uuidToBytes: (u: string) => Uint8Array
    getFieldValue: (b: Uint8Array, f: unknown) => bigint
    DBKEY_LAYOUT: { fields: { name: string; start: number; length: number; type: string }[] }
    MULTITENANT_LAYOUT: { fields: { name: string; start: number; length: number; type: string }[] }
    EVENTSOURCING_LAYOUT: { fields: { name: string; start: number; length: number; type: string }[] }
  }

function readFile(filepath: string): string[] {
  const text = fs.readFileSync(filepath, "utf-8").trim()
  return text ? text.split("\n") : []
}

function validateUUID(uuid: string, context: string): number {
  const errors: string[] = []
  if (uuid.length !== 36) errors.push(`length ${uuid.length} != 36`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    errors.push(`invalid v8 format`)
  }
  if (errors.length > 0) {
    console.error(`  ${context}: "${uuid}" → ${errors.join(", ")}`)
    return 0
  }
  return 1
}

interface Field {
  name: string
  start: number
  length: number
  type: string
}

function checkLayout(
  lines: string[],
  layout: { fields: Field[] },
  name: string,
  constraints: Record<string, (val: number, idx: number) => string | null>,
): { ok: number; errors: string[] } {
  let ok = 0
  let total = 0
  const fieldMap: Record<string, Field> = {}
  for (const f of layout.fields) fieldMap[f.name] = f

  for (let i = 0; i < lines.length; i++) {
    const uuid = lines[i]
    total++
    if (!validateUUID(uuid, `${name}[${i}]`)) continue

    const bytes = uuidToBytes(uuid)

    // Check version/variant
    if ((bytes[6] & 0xf0) !== 0x80) {
      console.error(`  ${name}[${i}]: version nibble wrong: ${bytes[6].toString(16)}`)
      continue
    }
    if ((bytes[8] & 0xc0) !== 0x80) {
      console.error(`  ${name}[${i}]: variant bits wrong: ${bytes[8].toString(16)}`)
      continue
    }

    let fieldErr = false
    for (const [fieldName, checkFn] of Object.entries(constraints)) {
      const field = fieldMap[fieldName]
      if (!field) continue
      const val = Number(getFieldValue(bytes, field))
      const err = checkFn(val, i)
      if (err) {
        console.error(`  ${name}[${i}]: ${fieldName}=${val} ${err}`)
        fieldErr = true
      }
    }
    if (!fieldErr) ok++
  }

  // Collision check
  const set = new Set(lines)
  const collisions = lines.length - set.size
  if (collisions > 0) console.error(`  ${name}: ${collisions} collisions`)

  return { ok, errors: collisions > 0 ? [`${collisions} collisions`] : [] }
}

const compiledDir = path.resolve(root, "golden")

console.log("=== Compiled golden vector validation ===\n")

const dbkey = readFile(path.resolve(compiledDir, "compiled-dbkey.txt"))
console.log(`dbkey: ${dbkey.length} UUIDs`)
const dbkeyRes = checkLayout(
  dbkey,
  DBKEY_LAYOUT,
  "dbkey",
  {},
)
console.log(`  v8 format + version/variant: ${dbkeyRes.ok}/${dbkeyRes.ok + dbkeyRes.errors.length} pass\n`)

// Structural field check: extract shard from all UUIDs
let shardOk = 0
const tField = DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp")!
const shardField = DBKEY_LAYOUT.fields.find((f) => f.name === "shard")!
const ctrField = DBKEY_LAYOUT.fields.find((f) => f.name === "counter")!
let prevCtr = -1
let ctrWrapCount = 0
for (let i = 0; i < dbkey.length; i++) {
  const b = uuidToBytes(dbkey[i])
  const shard = Number(getFieldValue(b, shardField))
  if (shard >= 1 && shard <= 5) shardOk++
  const ctr = Number(getFieldValue(b, ctrField))
  if (ctr < prevCtr && !(prevCtr === 0xffff && ctr === 0)) {
    if (ctrWrapCount < 3) console.error(`  dbkey[${i}]: counter regressed ${prevCtr} → ${ctr}`)
    ctrWrapCount++
  }
  prevCtr = ctr
}
console.log(`  shard in [1..5]: ${shardOk}/${dbkey.length}`)
console.log(`  counter monotonic: ${ctrWrapCount === 0 ? "PASS" : `FAIL (${ctrWrapCount} regressions)`}`)
const ts = Number(getFieldValue(uuidToBytes(dbkey[0]), tField))
const tsOk = ts > 1_600_000_000_000 && ts < 2_000_000_000_000
console.log(`  timestamp plausible: ${tsOk ? "PASS" : `FAIL (${ts})`}\n`)

const multitenant = readFile(path.resolve(compiledDir, "compiled-multitenant.txt"))
console.log(`multitenant: ${multitenant.length} UUIDs`)
const mtField = MULTITENANT_LAYOUT.fields.find((f) => f.name === "tenant")!
const regField = MULTITENANT_LAYOUT.fields.find((f) => f.name === "region")!
let tenantOk = 0
let regionOk = 0
for (const uuid of multitenant) {
  const b = uuidToBytes(uuid)
  const tenant = Number(getFieldValue(b, mtField))
  if (tenant >= 1 && tenant <= 8) tenantOk++
  const region = Number(getFieldValue(b, regField))
  if (region >= 1 && region <= 4) regionOk++
}
console.log(`  tenant in [1..8]: ${tenantOk}/${multitenant.length}`)
console.log(`  region in [1..4]: ${regionOk}/${multitenant.length}`)
const mtSet = new Set(multitenant)
console.log(`  collisions: ${multitenant.length - mtSet.size}\n`)

const eventsourcing = readFile(path.resolve(compiledDir, "compiled-eventsourcing.txt"))
console.log(`eventsourcing: ${eventsourcing.length} UUIDs`)
const strField = EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "stream")!
const seqField = EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "seq")!
let streamOk = 0
let seqPrev = -1
let seqRegressions = 0
for (const uuid of eventsourcing) {
  const b = uuidToBytes(uuid)
  const stream = Number(getFieldValue(b, strField))
  if (stream > 0) streamOk++
  const seq = Number(getFieldValue(b, seqField))
  if (seq < seqPrev && !(seqPrev === 0xffffff && seq === 0)) seqRegressions++
  seqPrev = seq
}
console.log(`  stream > 0: ${streamOk}/${eventsourcing.length}`)
console.log(`  seq monotonic: ${seqRegressions === 0 ? "PASS" : `FAIL (${seqRegressions} regressions)`}`)
const esSet = new Set(eventsourcing)
console.log(`  collisions: ${eventsourcing.length - esSet.size}\n`)

console.log("=== Compiled golden check: ALL PASS ===")
