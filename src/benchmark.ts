import {
  genV4Native,
  genV7,
  genMathRandom,
  genHashUUID,
  genGenoID,
  genStructuredGenoID,
  getStructuredGenerationMode,
  DBKEY_LAYOUT,
} from "./algo.js"
import { benchRepeated, benchRepeatedAsync, birthdayBound50, collisionTest, collisionTestAsync } from './bench-core.js';
import type { BenchStats } from './bench-core.js';

interface AlgoEntry {
  key: string
  name: string
  fn: () => string | Promise<string>
  async: boolean
  entropy: number
  source: string
  secLabel: string
}

const ALGOS: AlgoEntry[] = [
  {
    async: false,
    entropy: 122,
    fn: genV4Native,
    key: "v4",
    name: "crypto.randomUUID (v4)",
    secLabel: "High",
    source: "OS CSPRNG",
  },
  {
    async: false,
    entropy: 74,
    fn: genV7,
    key: "v7",
    name: "UUIDv7 (custom, RFC 9562)",
    secLabel: "High* (timestamp leaks creation time)",
    source: "OS CSPRNG",
  },
  {
    async: true,
    entropy: 121,
    fn: genHashUUID,
    key: "hash",
    name: "SHA-256 hash-derived (v5-style)",
    secLabel: "High (slower)",
    source: "OS CSPRNG + SHA-256",
  },
  {
    async: false,
    entropy: 122,
    fn: genMathRandom,
    key: "mr",
    name: "Math.random (v4-format)",
    secLabel: "Insecure (state-recoverable)",
    source: "Xorshift128+ PRNG",
  },
  {
    async: false,
    entropy: 122,
    fn: genGenoID,
    key: "geno",
    name: "GenoID (proposed, v8)",
    secLabel: "High (near-native speed)",
    source:
      "Pooled OS CSPRNG (refills every 256 UUIDs) + byte-level crossover/mutation",
  },
  {
    async: false,
    entropy: 50,
    fn: () => genStructuredGenoID(DBKEY_LAYOUT),
    key: "geno-struct",
    name: "GenoID-structured (dbkey, v8)",
    secLabel: "High (composition framework)",
    source:
      "Pooled CSPRNG + declared v8 layout (timestamp/shard/monotonic-counter) + field-boundary crossover + constraint repair",
  },
]

async function copyToClipboard(
  text: string,
  btn: HTMLButtonElement,
): Promise<void> {
  await navigator.clipboard.writeText(text)
  const orig = btn.textContent
  btn.textContent = "Copied!"
  btn.disabled = true
  setTimeout(() => {
    btn.textContent = orig
    btn.disabled = false
  }, 1200)
}

async function copyTableToClipboard(tableId: string, btn: HTMLButtonElement): Promise<void> {
  const table = document.querySelector(`#${tableId}`) as HTMLTableElement
  const rows = [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((cell) => (cell.textContent ?? "").trim()).join("\t"),
  )
  await copyToClipboard(rows.join("\n"), btn)
}

async function showSamples(): Promise<void> {
  const box = document.querySelector("#samples") as HTMLDivElement
  if (!box) {return}
  box.innerHTML = "Loading samples..."
  try {
    let html = ""
    for (const a of ALGOS) {
      const val = a.async ? await a.fn() : a.fn() as string
      const escaped = val.replaceAll(/\\/g, "\\\\").replaceAll(/'/g, "\\'")
      html += `<div><b>${a.name}:</b> <code>${val}</code> <button onclick="copyToClipboard('${escaped}', this)">Copy</button></div>`
    }
    box.innerHTML = html
  } catch (error) {
    box.innerHTML = `<p>Error loading samples: ${(error as Error).message}</p>`
  }
}

function log(msg: string): void {
  const el = document.querySelector("#log") as HTMLPreElement
  if (!el) {return}
  el.textContent += `${msg  }\n`
  el.scrollTop = el.scrollHeight
}

function fmt(x: number): string {
  if (x > 1e6) {return x.toExponential(3)}
  return x.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

// Repeated trials per generator so the in-browser table can show a 95% CI
// instead of a single-run point estimate (matches the Node-side benchmark).
const TRIALS = 10

async function runAll(): Promise<void> {
  const btn = document.querySelector("#runBtn") as HTMLButtonElement
  if (!btn) {return}
  const origLabel = btn.textContent
  btn.disabled = true
  btn.textContent = "Running..."
  const logEl = document.querySelector("#log") as HTMLPreElement
  if (logEl) {logEl.textContent = ""}
  // The evidence artifact must name the production path this run used, so
  // a reader can tell a compiled run from a lower-level or injected one.
  const plan = getStructuredGenerationMode()
  const planEl = document.querySelector("#planLabel") as HTMLDivElement
  if (planEl) {planEl.textContent = `Generation plan: ${plan}`}
  const nSync = Number.parseInt(
    (document.getElementById("nSync") as HTMLInputElement).value,
    10,
  )
  const nAsync = Number.parseInt(
    (document.getElementById("nAsync") as HTMLInputElement).value,
    10,
  )
  const nColl = Number.parseInt(
    (document.getElementById("nColl") as HTMLInputElement).value,
    10,
  )

  const results: Record<string, BenchStats> = {}
  try {
    for (const a of ALGOS) {
      btn.textContent = `Running... (speed: ${a.name})`
      log(`Benchmarking ${a.name} (n=${a.async ? nAsync : nSync}, ${TRIALS} trials)...`)
      const r = a.async
        ? await benchRepeatedAsync(a.fn as () => Promise<string>, nAsync, TRIALS)
        : benchRepeated(a.fn as () => string, nSync, TRIALS)
      results[a.key] = r
      log(
        `  -> ${fmt(r.mean)} ± ${fmt(r.std)} ops/sec (95% CI ${fmt(r.ci95[0])}–${fmt(r.ci95[1])})`,
      )
    }
  } catch (error) {
    log(`Error during speed benchmark: ${(error as Error).message}`)
    btn.textContent = origLabel
    btn.disabled = false
    return
  }

  const tbody = document.querySelector(
    "#resultsTable tbody",
  ) as HTMLTableSectionElement
  if (tbody) {
    tbody.innerHTML = ""
    for (const a of ALGOS) {
      const r = results[a.key]
      const tr = document.createElement("tr")
      tr.innerHTML = `<td>${a.name}</td>
      <td>${fmt(r.mean)} ± ${fmt(r.std)}</td>
      <td>${((1e6 / r.mean)).toFixed(3)} µs</td>
      <td>${fmt(r.ci95[0])}–${fmt(r.ci95[1])}</td>
      <td>${a.entropy}</td>
      <td>${a.source}</td>
      <td>${a.secLabel}</td>`
      tbody.append(tr)
    }
  }

  log(`Running collision test, n=${nColl} per algorithm...`)
  try {
    const collTbody = document.querySelector(
      "#collTable tbody",
    ) as HTMLTableSectionElement
    if (collTbody) {
      collTbody.innerHTML = ""
      for (const a of ALGOS) {
        btn.textContent = `Running... (collisions: ${a.name})`
        const n = a.async ? Math.min(nColl, 50_000) : nColl
        const colls = a.async
          ? await collisionTestAsync(a.fn as () => Promise<string>, n)
          : collisionTest(a.fn as () => string, n)
        const bound = birthdayBound50(a.entropy)
        const tr = document.createElement("tr")
        tr.innerHTML = `<td>${a.name}</td><td>${n.toLocaleString()}${
          a.async ? " (reduced, async cost)" : ""
        }</td><td>${colls}</td><td>${fmt(bound)}</td>`
        collTbody.append(tr)
        log(`  ${a.name}: ${colls} collisions in ${n.toLocaleString()} samples`)
      }
    }
  } catch (error) {
    log(`Error during collision test: ${(error as Error).message}`)
    btn.textContent = origLabel
    btn.disabled = false
    return
  }

  log("Done.")

  // Labeled native-baseline throughput callout: makes the "native v4 is slow
  // inside a JS engine" observation visible as a number rather than prose.
  const v4r = results["v4"]
  const poolR = results["geno"]
  const stR = results["geno-struct"]
  if (v4r && poolR && stR) {
    const v4 = v4r.mean
    const pool = poolR.mean
    const st = stR.mean
    const box = document.querySelector("#nativeCallout") as HTMLDivElement
    if (box) {
      box.innerHTML = `<p>Native baseline throughput (this browser engine):
        <b>v4 = ${fmt(v4)} ops/s</b>.
        GenoID pool = ${fmt(pool)} ops/s (${fmt(pool / v4)}× faster than native v4).
        GenoID-structured = ${fmt(st)} ops/s (${fmt(v4 / st)}× slower than native v4 in-browser).
        The native <code>crypto.randomUUID</code> call is comparatively slow inside a JS engine,
        which compresses the apparent cost of the structured framework.</p>`
    }
    log(
      `Native baseline: v4=${fmt(v4)} ops/s, GenoID pool=${fmt(pool)} ops/s (${fmt(pool / v4)}x faster), structured=${fmt(st)} ops/s (${fmt(v4 / st)}x slower vs v4).`,
    )
  }

  btn.textContent = origLabel
  btn.disabled = false
}

interface BenchmarkGlobals {
  runAll: typeof runAll
  copyToClipboard: typeof copyToClipboard
  copyTableToClipboard: typeof copyTableToClipboard
}

export function init(host?: Window & typeof globalThis): void {
  const w = host ?? (typeof window === "undefined" ? undefined : window)
  if (!w) {return}
  showSamples()
  const globals = w as Window & typeof globalThis & BenchmarkGlobals
  globals.runAll = runAll
  globals.copyToClipboard = copyToClipboard
  globals.copyTableToClipboard = copyTableToClipboard
}

export { runAll, copyToClipboard, copyTableToClipboard }
