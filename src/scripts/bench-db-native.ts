import { Client } from "pg"
import mysql from "mysql2/promise"
import type { RowDataPacket } from "mysql2"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { mulberry32 } from "./shared/cli-utils.ts"
import {
  DISTRIBUTIONS,
  ENGINES,
  WORKLOADS,
  enginesWithResults,
  percentiles,
  serverTarget,
  SERVER_ENV,
  tenantFor,
  unreachableMessage,
  validateNativeResult,
} from "./bench-db-native-core.ts"
import type { EngineName, EngineResult, Percentiles } from "./bench-db-native-core.ts"

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const ROWS = Number(arg("rows", "50000"))
const REPS = Math.max(5, Number(arg("reps", "5")))
const PROBES = Number(arg("probes", "500"))
const BATCH = 500
const WRITERS = Number(arg("writers", "4"))
const BLOB_BYTES = 64
const MODE = arg("mode", "both")
const OUT = arg("out", "results/db-native.json")
const root = path.resolve(import.meta.dirname, "..", "..")

const algo = (await import(pathToFileURL(path.join(root, "dist", "algo.js")).href)) as Record<
  string,
  any
>
const baselines = (await import(
  pathToFileURL(path.join(root, "src", "scripts", "baselines.ts")).href
)) as Record<string, any>

const SHARDFIRST = algo.completeLayout("shardfirst", [
  { constraint: { allowed: [1, 2, 3, 4, 5] }, length: 8, name: "shard", start: 0, type: "shard" },
  { length: 40, name: "ts", start: 8, type: "timestamp-ms" },
  { constraint: { monotonic: true }, length: 16, name: "counter", start: 66, type: "counter" },
])

const ARMS: Record<string, () => string> = {
  genoid_shardfirst: () => algo.genStructuredGenoID(SHARDFIRST),
  genoid_structured: () => algo.genStructuredGenoID(algo.DBKEY_LAYOUT),
  genoid_v8: algo.genGenoID,
  pg_uuid_v8: baselines.genPgUuidV8,
  ulid_v8: baselines.genUlidV8,
  uuid_v4: algo.genV4Native,
  uuid_v7: algo.genV7,
}


const hex = (uuid: string): string => uuid.replaceAll('-', "")
const now = () => performance.now()

interface Cell {
  reps: number
  insert?: Percentiles
  pointLookup?: Percentiles
  rangeScan?: unknown
  update?: Percentiles
  delete?: Percentiles
  maintenance?: Percentiles
  concurrentWriters?: number
  rowsPerSec: number
}

interface Engine {
  name: EngineName
  fresh: () => Promise<void>
  insertBatch: (ids: string[], tenants: number[], payload: string) => Promise<void>
  count: () => Promise<number>
  lookups: (ids: string[], probes: number) => Promise<number>
  rangeScan: (limit: number) => Promise<number>
  update: (limit: number) => Promise<void>
  remove: (limit: number) => Promise<number>
  maintenance: () => Promise<void>
  concurrentWriters: (perWriter: number) => Promise<number>
  plan: () => Promise<string>
  storage: () => Promise<Record<string, number>>
  walBytes: () => Promise<number | null>
  identity: () => Promise<{ serverVersion: string; serverConfig: Record<string, string> }>
  /** Release the driver's connections; without it the process never exits. */
  close: () => Promise<void>
}

const payloadHex = (random: () => number): string => {
  const bytes = Buffer.alloc(BLOB_BYTES)
  for (let i = 0; i < BLOB_BYTES; i += 1) {bytes[i] = Math.floor(random() * 256)}
  return bytes.toString("hex")
}

async function postgres(): Promise<Engine> {
  const connect = () =>
    new Client({
      database: process.env.PG_DB ?? "genoid",
      host: process.env.PG_HOST ?? "localhost",
      password: process.env.PG_PASSWORD ?? "password",
      port: Number(process.env.PG_PORT ?? 5432),
      user: process.env.PG_USER ?? "genoid",
    })
  const client = await connect()
  await client.connect()
  return {
    async close() {
      await client.end()
    },
    async concurrentWriters(perWriter) {
      const conns = await Promise.all(
        Array.from({ length: WRITERS }, async () => {
          const conn = connect()
          await conn.connect()
          return conn
        }),
      )
      const random = mulberry32(99)
      try {
        await Promise.all(
          conns.map(async (conn, writer) => {
            for (let i = 0; i < perWriter; i += 1) {
              const id = Buffer.alloc(16)
              id.writeUInt32BE(writer + 1, 0)
              id.writeUInt32BE(random() * 0xff_ff_ff_ff, 4)
              id.writeUInt32BE(random() * 0xff_ff_ff_ff, 8)
              id.writeUInt32BE(random() * 0xff_ff_ff_ff, 12)
              await conn.query("INSERT INTO t (id, tenant, payload) VALUES ($1, $2, $3)", [
                `\\x${id.toString("hex")}`,
                1 + (writer % 5),
                payloadHex(random),
              ])
            }
          }),
        )
      } finally {
        for (const conn of conns) {await conn.end()}
      }
      return perWriter * WRITERS
    },
    async count() {
      const res = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM t")
      return res.rows[0]?.n ?? 0
    },
    async fresh() {
      await client.query("DROP TABLE IF EXISTS t")
      await client.query("CREATE TABLE t (id bytea PRIMARY KEY, tenant int, payload bytea)")
    },
    async identity() {
      const version = await client.query<{ v: string }>("SELECT version() AS v")
      const settings = await client.query<{ name: string; setting: string }>(
        "SELECT name, setting FROM pg_settings WHERE name IN ('shared_buffers','max_connections','fsync','synchronous_commit','server_version')",
      )
      return {
        serverConfig: Object.fromEntries(settings.rows.map((row) => [row.name, row.setting])),
        serverVersion: version.rows[0]?.v ?? "",
      }
    },
    async insertBatch(ids, tenants, payload) {
      const values = ids.map((id, i) => `('\\x${id}'::bytea, ${tenants[i]}, '${payload}'::bytea)`)
      await client.query(`INSERT INTO t (id, tenant, payload) VALUES ${values.join(",")}`)
    },
    async lookups(ids, probes) {
      let hits = 0
      for (let i = 0; i < probes; i += 1) {
        const res = await client.query(`SELECT 1 FROM t WHERE id = '\\x${ids[i % ids.length]}'::bytea`)
        if (res.rowCount) {hits += 1}
      }
      return hits
    },
    async maintenance() {
      await client.query("VACUUM ANALYZE t")
    },
    name: "postgresql",
    async plan() {
      const res = await client.query("EXPLAIN (ANALYZE, BUFFERS) SELECT 1 FROM t WHERE id = '\\x00'::bytea")
      return res.rows.map((row: object) => String(Object.values(row)[0])).join("\n")
    },
    async rangeScan(limit) {
      const res = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM t WHERE id >= '\\x00'::bytea AND id < '\\xff'::bytea",
      )
      return Math.min(limit, res.rows[0]?.n ?? 0)
    },
    async remove(limit) {
      const res = await client.query(`DELETE FROM t WHERE ctid IN (SELECT ctid FROM t LIMIT ${limit})`)
      return res.rowCount ?? 0
    },
    async storage() {
      const res = await client.query<{ heap: number; idx: number; total: number }>(
        "SELECT pg_table_size('t') AS heap, pg_indexes_size('t') AS idx, pg_total_relation_size('t') AS total",
      )
      const row = res.rows[0] ?? { heap: 0, idx: 0, total: 0 }
      return { indexBytes: row.idx, tableBytes: row.heap, totalBytes: row.total }
    },
    async update(limit) {
      await client.query(
        `UPDATE t SET payload = decode(md5(random()::text), 'hex') WHERE ctid IN (SELECT ctid FROM t LIMIT ${limit})`,
      )
    },
    async walBytes() {
      const res = await client.query<{ written: string }>("SELECT pg_stat_wal.wal_bytes AS written FROM pg_stat_wal")
      return res.rows[0] ? Number(res.rows[0].written) : null
    },
  }
}

async function mysqlInnoDB(): Promise<Engine> {
  const connect = () =>
    mysql.createConnection({
      database: process.env.MYSQL_DB ?? "genoid",
      host: process.env.MYSQL_HOST ?? "localhost",
      password: process.env.MYSQL_PASSWORD ?? "password",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
    })
  const client = await connect()
  return {
    async close() {
      await client.end()
    },
    async concurrentWriters(perWriter) {
      const pool = mysql.createPool({
        connectionLimit: WRITERS,
        database: process.env.MYSQL_DB ?? "genoid",
        host: process.env.MYSQL_HOST ?? "localhost",
        password: process.env.MYSQL_PASSWORD ?? "password",
        port: Number(process.env.MYSQL_PORT ?? 3306),
        user: process.env.MYSQL_USER ?? "root",
      })
      const random = mulberry32(99)
      try {
        await Promise.all(
          Array.from({ length: WRITERS }, async (_, writer) => {
            for (let i = 0; i < perWriter; i += 1) {
              const id = Buffer.alloc(16)
              id.writeUInt32BE(writer + 1, 0)
              id.writeUInt32BE(Math.floor(random() * 0xff_ff_ff_ff), 4)
              id.writeUInt32BE(Math.floor(random() * 0xff_ff_ff_ff), 8)
              id.writeUInt32BE(Math.floor(random() * 0xff_ff_ff_ff), 12)
              await pool.query("INSERT INTO t (id, tenant, payload) VALUES (?, ?, ?)", [
                id,
                1 + (writer % 5),
                Buffer.from(payloadHex(random), "hex"),
              ])
            }
          }),
        )
      } finally {
        await pool.end()
      }
      return perWriter * WRITERS
    },
    async count() {
      const [rows] = await client.query<(RowDataPacket & { n: number })[]>("SELECT COUNT(*) AS n FROM t")
      return rows[0]?.n ?? 0
    },
    async fresh() {
      await client.query("DROP TABLE IF EXISTS t")
      await client.query("CREATE TABLE t (id BINARY(16) PRIMARY KEY, tenant INT, payload BLOB) ENGINE=InnoDB")
    },
    async identity() {
      const [version] = await client.query<(RowDataPacket & { v: string })[]>("SELECT VERSION() AS v")
      const [settings] = await client.query<
        (RowDataPacket & { buffer_pool: number; flush: number; max_conn: number })[]
      >(
        "SELECT @@innodb_buffer_pool_size AS buffer_pool, @@innodb_flush_log_at_trx_commit AS flush, @@max_connections AS max_conn",
      )
      const [row] = settings
      return {
        serverConfig: {
          innodb_buffer_pool_size: String(row?.buffer_pool ?? ""),
          innodb_flush_log_at_trx_commit: String(row?.flush ?? ""),
          max_connections: String(row?.max_conn ?? ""),
        },
        serverVersion: version[0]?.v ?? "",
      }
    },
    async insertBatch(ids, tenants, payload) {
      const values = ids.map((id, i) => `(UNHEX('${id}'), ${tenants[i]}, UNHEX('${payload}'))`)
      await client.query(`INSERT INTO t (id, tenant, payload) VALUES ${values.join(",")}`)
    },
    async lookups(ids, probes) {
      let hits = 0
      for (let i = 0; i < probes; i += 1) {
        const [rows] = await client.query<RowDataPacket[]>("SELECT id FROM t WHERE id = ?", [
          Buffer.from(ids[i % ids.length], "hex"),
        ])
        if (rows.length) {hits += 1}
      }
      return hits
    },
    async maintenance() {
      await client.query("OPTIMIZE TABLE t")
    },
    name: "mysql-innodb",
    async plan() {
      const [rows] = await client.query<RowDataPacket[]>("EXPLAIN FORMAT=JSON SELECT id FROM t WHERE id = ?", [
        Buffer.alloc(16),
      ])
      return JSON.stringify(rows[0] ?? {})
    },
    async rangeScan(limit) {
      const [rows] = await client.query<(RowDataPacket & { n: number })[]>(
        "SELECT COUNT(*) AS n FROM t WHERE id >= ?",
        [Buffer.alloc(16)],
      )
      return Math.min(limit, rows[0]?.n ?? 0)
    },
    async remove(limit) {
      const [result] = await client.query("DELETE FROM t LIMIT ?", [limit])
      return (result as { affectedRows?: number }).affectedRows ?? 0
    },
    async storage() {
      const [rows] = await client.query<(RowDataPacket & { data: number; idx: number })[]>(
        "SELECT data_length AS data, index_length AS idx FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 't'",
      )
      const [row] = rows
      return {
        indexBytes: Number(row?.idx ?? 0),
        tableBytes: Number(row?.data ?? 0),
        totalBytes: Number(row?.data ?? 0) + Number(row?.idx ?? 0),
      }
    },
    async update(limit) {
      await client.query("UPDATE t SET payload = payload LIMIT ?", [limit])
    },
    async walBytes() {
      const [rows] = await client.query<(RowDataPacket & { written: number })[]>(
        "SELECT VARIABLE_VALUE AS written FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Innodb_os_log_written'",
      )
      return rows[0] ? Number(rows[0].written) : null
    },
  }
}

interface Aggregate {
  reps: number
  insert: number[]
  pointLookup: number[]
  rangeScan: number[]
  update: number[]
  delete: number[]
  maintenance: number[]
  concurrent: number
}

async function runEngine(engine: Engine): Promise<EngineResult> {
  const arms: Record<string, Aggregate> = {}
  for (const arm of Object.keys(ARMS)) {
    arms[arm] = {
      concurrent: 0,
      delete: [],
      insert: [],
      maintenance: [],
      pointLookup: [],
      rangeScan: [],
      reps: 0,
      update: [],
    }
  }
  const queryPlans: Record<string, string> = {}
  const storage: Record<string, number> = {}
  const walBefore = await engine.walBytes()

  for (const distribution of DISTRIBUTIONS) {
    for (const arm of Object.keys(ARMS)) {
      const acc = arms[arm]
      for (let rep = 0; rep < REPS; rep += 1) {
        const random = mulberry32(1000 + rep)
        const ids: string[] = []
        await engine.fresh()

        const started = now()
        for (let base = 0; base < ROWS; base += BATCH) {
          const size = Math.min(BATCH, ROWS - base)
          const batchIds: string[] = []
          const tenants: number[] = []
          for (let i = 0; i < size; i += 1) {
            const id = hex(ARMS[arm]())
            batchIds.push(id)
            tenants.push(tenantFor(distribution, base + i, random))
            if (base + i < PROBES) {ids.push(id)}
          }
          await engine.insertBatch(batchIds, tenants, payloadHex(random))
        }
        const elapsed = (now() - started) / 1000
        acc.insert.push(ROWS / elapsed)
        acc.reps += 1

        const lookupStart = now()
        await engine.lookups(ids, PROBES)
        acc.pointLookup.push(now() - lookupStart)

        const rangeStart = now()
        await engine.rangeScan(5000)
        acc.rangeScan.push(now() - rangeStart)

        const updateStart = now()
        await engine.update(1000)
        acc.update.push(now() - updateStart)

        const deleteStart = now()
        await engine.remove(1000)
        acc.delete.push(now() - deleteStart)

        if (rep === REPS - 1) {
          const maintenanceStart = now()
          await engine.maintenance()
          acc.maintenance.push(now() - maintenanceStart)
          Object.assign(storage, await engine.storage())
          queryPlans[arm] = await engine.plan()
        }
      }
      const writerStart = now()
      const written = await engine.concurrentWriters(200)
      acc.concurrent += written / ((now() - writerStart) / 1000)
      console.log(
        `  ${engine.name} ${arm} ${distribution}: ${acc.insert.length} reps, ${written} concurrent rows`,
      )
    }
  }

  const walAfter = await engine.walBytes()
  const identity = await engine.identity()
  const cells: Record<string, Cell> = {}
  for (const [arm, acc] of Object.entries(arms)) {
    const insert = percentiles(acc.insert)
    cells[arm] = {
      concurrentWriters: acc.concurrent / DISTRIBUTIONS.length,
      delete: percentiles(acc.delete),
      insert,
      maintenance: percentiles(acc.maintenance),
      pointLookup: percentiles(acc.pointLookup),
      rangeScan: percentiles(acc.rangeScan),
      reps: acc.reps / DISTRIBUTIONS.length,
      rowsPerSec: insert.p50,
      update: percentiles(acc.update),
    }
  }

  return {
    arms: cells,
    distributions: [...DISTRIBUTIONS],
    engine: engine.name,
    maintenance: {
      cells: Object.keys(cells).length,
      totalSamples: Object.values(cells).reduce(
        (sum, cell) => sum + (cell.maintenance?.samples ?? 0),
        0,
      ),
    },
    queryPlans,
    reps: REPS,
    rows: ROWS,
    serverConfig: identity.serverConfig,
    serverVersion: identity.serverVersion,
    storage,
    walBytes:
      walBefore === null || walAfter === null ? null : Math.max(0, walAfter - walBefore),
    workloads: [...WORKLOADS],
  }
}

const commit = (): string => {
  if (process.env.GENOID_COMMIT) {return process.env.GENOID_COMMIT}
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim()
  } catch {
    return "unknown"
  }
}

const out: Record<string, unknown> = {
  config: { batch: BATCH, blobBytes: BLOB_BYTES, probes: PROBES, reps: REPS, rows: ROWS, writers: WRITERS },
  generatedAt: new Date().toISOString(),
  generationModes: { structured: algo.getStructuredGenerationMode() },
  hardware: {
    arch: process.arch,
    cores: process.env.NUMBER_OF_PROCESSORS ?? "unknown",
    cpu: process.env.PROCESSOR_IDENTIFIER ?? "unknown",
    platform: process.platform,
  },
  implementationCommit: commit(),
}

const MODE_ALIASES: Record<string, EngineName> = { mysql: "mysql-innodb", pg: "postgresql" }
const targets: EngineName[] =
  MODE === "both" ? [...ENGINES] : [MODE_ALIASES[MODE] ?? (MODE as EngineName)]

const isServerReachable = (host: string, port: number, timeoutMs = 4000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect(port, host)
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })

// A missing server is an environment precondition, not a measurement. Fail
// with the connection target and the env vars to set instead of a raw
// ECONNREFUSED stack trace from the pg/mysql2 driver.
const SERVER_TARGETS = Object.fromEntries(
  targets.map((name) => [
    name,
    { ...serverTarget(name, process.env), env: SERVER_ENV[name] },
  ]),
) as Record<EngineName, { host: string; port: number; env: string }>

for (const name of targets) {
  const target = SERVER_TARGETS[name]
  if (!(await isServerReachable(target.host, target.port))) {
    console.error(`\n${unreachableMessage(name, target).join("\n")}`)
    process.exit(2)
  }
}

async function measureEngine(engine: Engine): Promise<EngineResult> {
  try {
    const result = await runEngine(engine)
    validateNativeResult(result)
    return result
  } finally {
    await engine.close()
  }
}

for (const name of targets) {
  const engine = name === "postgresql" ? await postgres() : await mysqlInnoDB()
  console.log(`\n=== ${name} rows=${ROWS} reps=${REPS} distributions=${DISTRIBUTIONS.length} arms=${Object.keys(ARMS).length} ===`)
  const started = now()
  out[name] = await measureEngine(engine)
  console.log(`${name} complete in ${((now() - started) / 1000).toFixed(1)}s`)
}

mkdirSync(path.dirname(path.resolve(root, OUT)), { recursive: true })
out.engines = enginesWithResults(out)
writeFileSync(path.resolve(root, OUT), `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${OUT}`)
