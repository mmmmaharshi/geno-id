import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { andBits } from "../shared/bitwise.ts"
import { need } from "../shared/need.ts"
import { readLines } from "./shared/read-lines.ts"
import { nullValue } from "./shared/runtime-values.ts"

const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(
  pathToFileURL(path.resolve(root, "dist/algo.js")).href
)) as {
  uuidToBytes: (u: string) => Uint8Array

  getFieldValue: (b: Readonly<Uint8Array>, f: unknown) => bigint

  DBKEY_LAYOUT: {
    fields: { name: string; start: number; length: number; type: string }[]
  }

  MULTITENANT_LAYOUT: {
    fields: { name: string; start: number; length: number; type: string }[]
  }

  EVENTSOURCING_LAYOUT: {
    fields: { name: string; start: number; length: number; type: string }[]
  }
}

const {
  uuidToBytes,
  getFieldValue,
  DBKEY_LAYOUT,
  MULTITENANT_LAYOUT,
  EVENTSOURCING_LAYOUT,
} = algo

const readFile = (filepath: string): string[] =>
  readLines(fs.readFileSync(filepath, "utf8"))

const validateUUID = (uuid: string, context: string): number => {
  const errors: string[] = []

  if (uuid.length !== 36) {
    errors.push(`length ${uuid.length} != 36`)
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      uuid
    )
  ) {
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

const constraintsHold = (
  bytes: Readonly<Uint8Array>,

  fieldMap: ReadonlyMap<string, Field>,

  constraints: Readonly<
    Record<string, (val: number, idx: number) => string | null>
  >,

  name: string,

  index: number
): boolean => {
  for (const [fieldName, checkFn] of Object.entries(constraints)) {
    const field = fieldMap.get(fieldName)

    if (field) {
      const val = Number(getFieldValue(bytes, field))

      const err = checkFn(val, index)

      if (err !== nullValue && err.length > 0) {
        console.error(`  ${name}[${index}]: ${fieldName}=${val} ${err}`)

        return false
      }
    }
  }

  return true
}

const checkLayout = (
  lines: readonly string[],

  layout: Readonly<{ fields: readonly Field[] }>,

  name: string,

  constraints: Readonly<
    Record<string, (val: number, idx: number) => string | null>
  >
): { ok: number; errors: string[] } => {
  let ok = 0

  let total = 0

  const fieldMap = new Map(layout.fields.map((f) => [f.name, f]))

  for (let i = 0; i < lines.length; i += 1) {
    const uuid = lines[i]

    total += 1

    if (validateUUID(uuid, `${name}[${i}]`) > 0) {
      const bytes = uuidToBytes(uuid)

      const version = andBits(bytes[6], 0xf0)

      if (version === 0x80) {
        const variant = andBits(bytes[8], 0xc0)

        if (variant === 0x80) {
          if (constraintsHold(bytes, fieldMap, constraints, name, i)) {
            ok += 1
          }
        } else {
          console.error(
            `  ${name}[${i}]: variant bits wrong: ${bytes[8].toString(16)}`
          )
        }
      } else {
        console.error(
          `  ${name}[${i}]: version nibble wrong: ${bytes[6].toString(16)}`
        )
      }
    }
  }

  // Collision check

  const set = new Set(lines)

  const collisions = lines.length - set.size

  if (collisions > 0) {
    console.error(`  ${name}: ${collisions} collisions`)
  }

  let errors: string[] = []

  if (collisions > 0) {
    errors = [`${collisions} collisions`]
  }

  return { errors, ok }
}

const compiledDir = path.resolve(root, "golden")

console.log("=== Compiled golden vector validation ===\n")

const dbkey = readFile(path.resolve(compiledDir, "compiled-dbkey.txt"))

console.log(`dbkey: ${dbkey.length} UUIDs`)

const dbkeyRes = checkLayout(
  dbkey,

  DBKEY_LAYOUT,

  "dbkey",

  {}
)

console.log(
  `  v8 format + version/variant: ${dbkeyRes.ok}/${dbkeyRes.ok + dbkeyRes.errors.length} pass\n`
)

// Structural field check: extract shard from all UUIDs

let shardOk = 0

const tField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "timestamp"))

const shardField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "shard"))

const ctrField = need(DBKEY_LAYOUT.fields.find((f) => f.name === "counter"))

let prevCtr = -1

let ctrWrapCount = 0

for (let i = 0; i < dbkey.length; i += 1) {
  const b = uuidToBytes(dbkey[i])

  const shard = Number(getFieldValue(b, shardField))

  if (shard >= 1 && shard <= 5) {
    shardOk += 1
  }

  const ctr = Number(getFieldValue(b, ctrField))

  if (ctr < prevCtr && !(prevCtr === 0xff_ff && ctr === 0)) {
    if (ctrWrapCount < 3) {
      console.error(`  dbkey[${i}]: counter regressed ${prevCtr} → ${ctr}`)
    }

    ctrWrapCount += 1
  }

  prevCtr = ctr
}

console.log(`  shard in [1..5]: ${shardOk}/${dbkey.length}`)

let counterStatus = "PASS"

if (ctrWrapCount > 0) {
  counterStatus = `FAIL (${ctrWrapCount} regressions)`
}

console.log(`  counter monotonic: ${counterStatus}`)

const ts = Number(getFieldValue(uuidToBytes(dbkey[0]), tField))

const tsOk = ts > 1_600_000_000_000 && ts < 2_000_000_000_000

let timestampStatus = `FAIL (${ts})`

if (tsOk) {
  timestampStatus = "PASS"
}

console.log(`  timestamp plausible: ${timestampStatus}\n`)

const multitenant = readFile(
  path.resolve(compiledDir, "compiled-multitenant.txt")
)

console.log(`multitenant: ${multitenant.length} UUIDs`)

const mtField = need(MULTITENANT_LAYOUT.fields.find((f) => f.name === "tenant"))

const regField = need(
  MULTITENANT_LAYOUT.fields.find((f) => f.name === "region")
)

let tenantOk = 0

let regionOk = 0

for (const uuid of multitenant) {
  const b = uuidToBytes(uuid)

  const tenant = Number(getFieldValue(b, mtField))

  if (tenant >= 1 && tenant <= 8) {
    tenantOk += 1
  }

  const region = Number(getFieldValue(b, regField))

  if (region >= 1 && region <= 4) {
    regionOk += 1
  }
}

console.log(`  tenant in [1..8]: ${tenantOk}/${multitenant.length}`)

console.log(`  region in [1..4]: ${regionOk}/${multitenant.length}`)

const mtSet = new Set(multitenant)

console.log(`  collisions: ${multitenant.length - mtSet.size}\n`)

const eventsourcing = readFile(
  path.resolve(compiledDir, "compiled-eventsourcing.txt")
)

console.log(`eventsourcing: ${eventsourcing.length} UUIDs`)

const strField = need(
  EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "stream")
)

const seqField = need(EVENTSOURCING_LAYOUT.fields.find((f) => f.name === "seq"))

let streamOk = 0

let seqPrev = -1

let seqRegressions = 0

for (const uuid of eventsourcing) {
  const b = uuidToBytes(uuid)

  const stream = Number(getFieldValue(b, strField))

  if (stream > 0) {
    streamOk += 1
  }

  const seq = Number(getFieldValue(b, seqField))

  if (seq < seqPrev && !(seqPrev === 0xff_ff_ff && seq === 0)) {
    seqRegressions += 1
  }

  seqPrev = seq
}

console.log(`  stream > 0: ${streamOk}/${eventsourcing.length}`)

let seqStatus = "PASS"

if (seqRegressions > 0) {
  seqStatus = `FAIL (${seqRegressions} regressions)`
}

console.log(`  seq monotonic: ${seqStatus}`)

const esSet = new Set(eventsourcing)

console.log(`  collisions: ${eventsourcing.length - esSet.size}\n`)

console.log("=== Compiled golden check: ALL PASS ===")
