import {
  genV4Native,
  genV7,
  genMathRandom,
  genHashUUID,
  genGenoID,
  genStructuredGenoID,
  completeLayout,
} from "./algo.js"
import {
  benchSync,
  benchAsyncBatched,
  birthdayBound50,
  collisionTest,
  collisionTestAsync,
  type BenchResult,
} from "./bench-core.js"

interface AlgoEntry {
  key: string
  name: string
  fn: () => string | Promise<string>
  async: boolean
  entropy: number
  source: string
  secLabel: string
}

const DBKEY_LAYOUT = completeLayout("dbkey", [
  { name: "timestamp", start: 0, length: 48, type: "timestamp-ms" },
  {
    name: "shard",
    start: 52,
    length: 8,
    type: "shard",
    constraint: { allowed: [1, 2, 3, 4, 5] },
  },
  {
    name: "counter",
    start: 66,
    length: 16,
    type: "counter",
    constraint: { monotonic: true },
  },
])

const ALGOS: AlgoEntry[] = [
  {
    key: "v4",
    name: "crypto.randomUUID (v4)",
    fn: genV4Native,
    async: false,
    entropy: 122,
    source: "OS CSPRNG",
    secLabel: "High",
  },
  {
    key: "v7",
    name: "UUIDv7 (custom, RFC 9562)",
    fn: genV7,
    async: false,
    entropy: 74,
    source: "OS CSPRNG",
    secLabel: "High* (timestamp leaks creation time)",
  },
  {
    key: "hash",
    name: "SHA-256 hash-derived (v5-style)",
    fn: genHashUUID,
    async: true,
    entropy: 121,
    source: "OS CSPRNG + SHA-256",
    secLabel: "High (slower)",
  },
  {
    key: "mr",
    name: "Math.random (v4-format)",
    fn: genMathRandom,
    async: false,
    entropy: 122,
    source: "Xorshift128+ PRNG",
    secLabel: "Insecure (state-recoverable)",
  },
  {
    key: "geno",
    name: "GenoID (proposed, GA-inspired, v8)",
    fn: genGenoID,
    async: false,
    entropy: 122,
    source:
      "Pooled OS CSPRNG draws (64 UUIDs/call) + byte-level GA crossover/mutation",
    secLabel: "High (near-native speed)",
  },
  {
    key: "geno-struct",
    name: "GenoID-structured (dbkey, v8)",
    fn: () => genStructuredGenoID(DBKEY_LAYOUT),
    async: false,
    entropy: 50,
    source:
      "Pooled CSPRNG + declared v8 layout (timestamp/shard/monotonic-counter) + field-boundary crossover + constraint repair",
    secLabel: "High (composition framework)",
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

function copyTableToClipboard(tableId: string, btn: HTMLButtonElement): void {
  const table = document.getElementById(tableId) as HTMLTableElement
  const rows = [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((cell) => (cell.textContent ?? "").trim()).join("\t"),
  )
  copyToClipboard(rows.join("\n"), btn)
}

async function showSamples(): Promise<void> {
  const box = document.getElementById("samples") as HTMLDivElement
  if (!box) return
  box.innerHTML = "Loading samples..."
  let html = ""
  for (const a of ALGOS) {
    const val = a.async ? await a.fn() : a.fn() as string
    const escaped = val.replace(/'/g, "\\'")
    html += `<div><b>${a.name}:</b> <code>${val}</code> <button onclick="copyToClipboard('${escaped}', this)">Copy</button></div>`
  }
  box.innerHTML = html
}

function log(msg: string): void {
  const el = document.getElementById("log") as HTMLPreElement
  if (!el) return
  el.textContent += msg + "\n"
  el.scrollTop = el.scrollHeight
}

function fmt(x: number): string {
  if (x > 1e6) return x.toExponential(3)
  return x.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

async function runAll(): Promise<void> {
  const btn = document.getElementById("runBtn") as HTMLButtonElement
  if (!btn) return
  const origLabel = btn.textContent
  btn.disabled = true
  btn.textContent = "Running..."
  const logEl = document.getElementById("log") as HTMLPreElement
  if (logEl) logEl.textContent = ""
  const nSync = parseInt(
    (document.getElementById("nSync") as HTMLInputElement).value,
    10,
  )
  const nAsync = parseInt(
    (document.getElementById("nAsync") as HTMLInputElement).value,
    10,
  )
  const nColl = parseInt(
    (document.getElementById("nColl") as HTMLInputElement).value,
    10,
  )

  const results: Record<string, BenchResult> = {}
  for (const a of ALGOS) {
    btn.textContent = `Running... (speed: ${a.name})`
    log(`Benchmarking ${a.name} (n=${a.async ? nAsync : nSync})...`)
    const r = a.async
      ? await benchAsyncBatched(a.fn as () => Promise<string>, nAsync)
      : await benchSync(a.fn as () => string, nSync)
    results[a.key] = r
    log(
      `  -> ${fmt(r.opsPerSec)} ops/sec, ${((r.elapsed / r.n) * 1000).toFixed(3)} µs/op`,
    )
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
      <td>${fmt(r.opsPerSec)}</td>
      <td>${((r.elapsed / r.n) * 1000).toFixed(3)} µs</td>
      <td>${a.entropy}</td>
      <td>${a.source}</td>
      <td>${a.secLabel}</td>`
      tbody.appendChild(tr)
    }
  }

  log(`Running collision test, n=${nColl} per algorithm...`)
  const collTbody = document.querySelector(
    "#collTable tbody",
  ) as HTMLTableSectionElement
  if (collTbody) {
    collTbody.innerHTML = ""
    for (const a of ALGOS) {
      btn.textContent = `Running... (collisions: ${a.name})`
      const n = a.async ? Math.min(nColl, 50000) : nColl
      const colls = a.async
        ? await collisionTestAsync(a.fn as () => Promise<string>, n)
        : collisionTest(a.fn as () => string, n)
      const bound = birthdayBound50(a.entropy)
      const tr = document.createElement("tr")
      tr.innerHTML = `<td>${a.name}</td><td>${n.toLocaleString()}${
        a.async ? " (reduced, async cost)" : ""
      }</td><td>${colls}</td><td>${fmt(bound)}</td>`
      collTbody.appendChild(tr)
      log(`  ${a.name}: ${colls} collisions in ${n.toLocaleString()} samples`)
    }
  }

  log("Done.")

  // Labeled native-baseline throughput callout: makes the "native v4 is slow
  // inside a JS engine" observation visible as a number rather than prose.
  const v4r = results["v4"]
  const poolR = results["geno"]
  const stR = results["geno-struct"]
  if (v4r && poolR && stR) {
    const v4 = v4r.opsPerSec
    const pool = poolR.opsPerSec
    const st = stR.opsPerSec
    const box = document.getElementById("nativeCallout") as HTMLDivElement
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

export function init(host?: Window & typeof globalThis): void {
  const w = host ?? (typeof window !== "undefined" ? window : undefined)
  if (!w) return
  showSamples()
  ;(w as any).runAll = runAll
  ;(w as any).copyToClipboard = copyToClipboard
  ;(w as any).copyTableToClipboard = copyTableToClipboard
}

export { runAll, copyToClipboard, copyTableToClipboard }
