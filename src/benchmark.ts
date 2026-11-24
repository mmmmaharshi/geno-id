import {
  DBKEY_LAYOUT,
  genGenoID,
  genHashUUID,
  genMathRandom,
  genStructuredGenoID,
  genV4Native,
  genV7,
  getStructuredGenerationMode,
} from "./algo.js"
import { absentValue, need } from "./shared/need.js"
import {
  benchRepeated,
  benchRepeatedAsync,
  birthdayBound50,
  collisionTest,
  collisionTestAsync,
} from "./bench-core.js"

interface AlgoMetadata {
  readonly key: string
  readonly name: string
  readonly entropy: number
  readonly source: string
  readonly secLabel: string
}

type AlgoEntry =
  | (AlgoMetadata & { readonly  async: false; readonly  fn: () => string })
  | (AlgoMetadata & { readonly  async: true; readonly  fn: () => Promise<string> })

const ALGOS: readonly AlgoEntry[] = [
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

const queryButton = (selector: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(selector)

const queryDiv = (selector: string): HTMLDivElement | null =>
  document.querySelector<HTMLDivElement>(selector)

const queryInput = (selector: string): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>(selector)

const queryPre = (selector: string): HTMLPreElement | null =>
  document.querySelector<HTMLPreElement>(selector)

const queryTable = (selector: string): HTMLTableElement | null =>
  document.querySelector<HTMLTableElement>(selector)

const queryTableSection = (selector: string): HTMLTableSectionElement | null =>
  document.querySelector<HTMLTableSectionElement>(selector)

const requireElement = <ElementType extends Element,>(
  element: ElementType | null,
): ElementType => {
  if (element === null) {
    throw new TypeError("required benchmark element is missing")
  }
  return element
}

interface ClipboardButton {
  readonly textContent: string | null
  readonly disabled: boolean
}

const cellText = (cell: { readonly  textContent: string | null }): string =>
  cell.textContent ?? ""

const copyToClipboard = async (
  text: string,
  btn: Readonly<ClipboardButton>,
): Promise<void> => {
  await navigator.clipboard.writeText(text)
  const button = btn as HTMLButtonElement
  const originalText = button.textContent
  button.textContent = "Copied!"
  button.disabled = true
  setTimeout(() => {
    button.textContent = originalText
    button.disabled = false
  }, 1200)
}

const copyTableToClipboard = async (
  tableId: string,
  btn: Readonly<ClipboardButton>,
): Promise<void> => {
  const table = requireElement(queryTable(`#${tableId}`))
  const rows = [...table.querySelectorAll("tr")].map((row) =>
    [...row.children].map((cell) => cellText(cell).trim()).join("\t"),
  )
  await copyToClipboard(rows.join("\n"), btn)
}

const showSamples = async (): Promise<void> => {
  const box = queryDiv("#samples")
  if (!box) {
    return
  }
  box.innerHTML = "Loading samples..."
  try {
    const values = await Promise.all(
      ALGOS.map(async (algo: Readonly<AlgoEntry>) => {
        if (algo.async) {
          const value = await algo.fn()
          return value
        }
        return algo.fn()
      }),
    )
    let html = ""
    for (const [index, algo] of ALGOS.entries()) {
      const value = values[index]
      const escaped = value
        .replaceAll("\\", String.raw`\\`)
        .replaceAll("'", String.raw`\'`)
      html += `<div><b>${algo.name}:</b> <code>${value}</code> <button onclick="copyToClipboard('${escaped}', this)">Copy</button></div>`
    }
    box.innerHTML = html
  } catch (error) {
    box.innerHTML = `<p>Error loading samples: ${(error as Error).message}</p>`
  }
}

const log = (message: string): void => {
  const element = queryPre("#log")
  if (!element) {
    return
  }
  element.textContent += `${message}\n`
  element.scrollTop = element.scrollHeight
}

const DEFAULT_LOCALE: string | undefined = absentValue

const fmt = (value: number): string => {
  if (value > 1e6) {
    return value.toExponential(3)
  }
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })
}

// Repeated trials per generator so the in-browser table can show a 95% CI
// Instead of a single-run point estimate (matches the Node-side benchmark).
const TRIALS = 10
const ASYNC_COLLISION_BATCH_SIZE = 100

type BenchStats = ReturnType<typeof benchRepeated>

const measureAlgorithm = async (
  algo: Readonly<AlgoEntry>,
  syncCount: number,
  asyncCount: number,
): Promise<BenchStats> => {
  if (algo.async) {
    const result = await benchRepeatedAsync(algo.fn, asyncCount, TRIALS)
    return result
  }
  return benchRepeated(algo.fn, syncCount, TRIALS)
}

const testCollisions = async (
  algo: Readonly<AlgoEntry>,
  count: number,
): Promise<number> => {
  if (algo.async) {
    const collisions = await collisionTestAsync(algo.fn, count, ASYNC_COLLISION_BATCH_SIZE)
    return collisions
  }
  return collisionTest(algo.fn, count)
}

const runAll = async (): Promise<void> => {
  const button = queryButton("#runBtn")
  if (!button) {
    return
  }
  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = "Running..."
  const logElement = queryPre("#log")
  if (logElement) {
    logElement.textContent = ""
  }
  // The evidence artifact must name the production path this run used, so
  // A reader can tell a compiled run from a lower-level or injected one.
  const plan = getStructuredGenerationMode()
  const planElement = queryDiv("#planLabel")
  if (planElement) {
    planElement.textContent = `Generation plan: ${plan}`
  }
  const syncInput = requireElement(queryInput("#nSync"))
  const asyncInput = requireElement(queryInput("#nAsync"))
  const collisionInput = requireElement(queryInput("#nColl"))
  const syncCount = Math.trunc(Number(syncInput.value))
  const asyncCount = Math.trunc(Number(asyncInput.value))
  const collisionCount = Math.trunc(Number(collisionInput.value))

  const results = new Map<string, BenchStats>()
  try {
    const runAlgorithm = async (index: number): Promise<void> => {
      if (index >= ALGOS.length) {
        return
      }
      const algo = ALGOS[index]
      button.textContent = `Running... (speed: ${algo.name})`
      let iterations = syncCount
      if (algo.async) {
        iterations = asyncCount
      }
      log(`Benchmarking ${algo.name} (n=${iterations}, ${TRIALS} trials)...`)
      const result = await measureAlgorithm(algo, syncCount, asyncCount)
      results.set(algo.key, result)
      log(
        `  -> ${fmt(result.mean)} ± ${fmt(result.std)} ops/sec (95% CI ${fmt(result.ci95[0])}–${fmt(result.ci95[1])})`,
      )
      await runAlgorithm(index + 1)
    }
    await runAlgorithm(0)
  } catch (error) {
    log(`Error during speed benchmark: ${(error as Error).message}`)
    button.textContent = originalLabel
    button.disabled = false
    return
  }

  const tableBody = queryTableSection("#resultsTable tbody")
  if (tableBody) {
    tableBody.replaceChildren()
    for (const algo of ALGOS) {
      const result = need(results.get(algo.key))
      const row = document.createElement("tr")
      row.innerHTML = `<td>${algo.name}</td>
    <td>${fmt(result.mean)} ± ${fmt(result.std)}</td>
    <td>${(1e6 / result.mean).toFixed(3)} µs</td>
    <td>${fmt(result.ci95[0])}–${fmt(result.ci95[1])}</td>
    <td>${algo.entropy}</td>
    <td>${algo.source}</td>
    <td>${algo.secLabel}</td>`
      tableBody.append(row)
    }
  }

  log(`Running collision test, n=${collisionCount} per algorithm...`)
  try {
    const collisionBody = queryTableSection("#collTable tbody")
    if (collisionBody) {
      collisionBody.replaceChildren()
      const runCollision = async (index: number): Promise<void> => {
        if (index >= ALGOS.length) {
          return
        }
        const algo = ALGOS[index]
        button.textContent = `Running... (collisions: ${algo.name})`
        let count = collisionCount
        if (algo.async) {
          count = Math.min(collisionCount, 50_000)
        }
        const collisions = await testCollisions(algo, count)
        const bound = birthdayBound50(algo.entropy)
        let countLabel = count.toLocaleString()
        if (algo.async) {
          countLabel += " (reduced, async cost)"
        }
        const row = document.createElement("tr")
        row.innerHTML = `<td>${algo.name}</td><td>${countLabel}</td><td>${collisions}</td><td>${fmt(bound)}</td>`
        collisionBody.append(row)
        log(
          `  ${algo.name}: ${collisions} collisions in ${count.toLocaleString()} samples`,
        )
        await runCollision(index + 1)
      }
      await runCollision(0)
    }
  } catch (error) {
    log(`Error during collision test: ${(error as Error).message}`)
    button.textContent = originalLabel
    button.disabled = false
    return
  }

  log("Done.")

  // Labeled native-baseline throughput callout: makes the "native v4 is slow
  // Inside a JS engine, this observation is visible as a number rather than prose.
  const v4Result = results.get("v4")
  const poolResult = results.get("geno")
  const structuredResult = results.get("geno-struct")
  if (v4Result && poolResult && structuredResult) {
    const v4 = v4Result.mean
    const pool = poolResult.mean
    const structured = structuredResult.mean
    const box = queryDiv("#nativeCallout")
    if (box) {
      box.innerHTML = `<p>Native baseline throughput (this browser engine):
      <b>v4 = ${fmt(v4)} ops/s</b>.
      GenoID pool = ${fmt(pool)} ops/s (${fmt(pool / v4)}× faster than native v4).
      GenoID-structured = ${fmt(structured)} ops/s (${fmt(v4 / structured)}× slower than native v4 in-browser).
      The native <code>crypto.randomUUID</code> call is comparatively slow inside a JS engine,
      which compresses the apparent cost of the structured framework.</p>`
    }
    log(
      `Native baseline: v4=${fmt(v4)} ops/s, GenoID pool=${fmt(pool)} ops/s (${fmt(pool / v4)}x faster), structured=${fmt(structured)} ops/s (${fmt(v4 / structured)}x slower vs v4).`,
    )
  }

  button.textContent = originalLabel
  button.disabled = false
}

interface BenchmarkGlobals {
  runAll: typeof runAll
  copyToClipboard: typeof copyToClipboard
  copyTableToClipboard: typeof copyTableToClipboard
}

export const init = (host?: Readonly<object>): void => {
  const browserWindow = Reflect.get(
    globalThis,
    "window",
  ) as Window & typeof globalThis | undefined
  const targetWindow = host ?? browserWindow
  if (!targetWindow) {
    return
  }
  void showSamples()
  const globals = targetWindow as Window & typeof globalThis & BenchmarkGlobals
  globals.runAll = runAll
  globals.copyToClipboard = copyToClipboard
  globals.copyTableToClipboard = copyTableToClipboard
}

export { runAll, copyToClipboard, copyTableToClipboard }
