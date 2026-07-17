#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import type { Browser } from "puppeteer"
import puppeteer from "puppeteer"

const __dirname = import.meta.dirname
const root = path.resolve(__dirname, "..")

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) {
      args[m[1]] = m[2] === undefined ? true : m[2]
    }
  }
  return args
}

interface LaunchFn {
  (opts: Record<string, unknown>): Promise<Browser>
}

interface BenchOptions {
  launch?: LaunchFn
}

interface BenchInputs {
  nAsync: string
  nColl: string
  nSync: string
}

interface BenchOutput {
  browserErrors: string[]
  collisions: Record<string, string>[]
  htmlPath: string
  inputs: BenchInputs
  rawLog: string
  results: Record<string, string>[]
  timestamp: string
  userAgent: string
}

async function runBenchmark(
  args: Record<string, string | boolean>,
  {
    launch = (opts) => puppeteer.launch(opts) as Promise<Browser>,
  }: BenchOptions = {},
): Promise<BenchOutput> {
  const htmlPath = path.resolve(
    typeof args.html === "string" ? args.html : path.join(root, "index.html"),
  )
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}`)
  }

  const timeout =
    typeof args.timeout === "string"
      ? Number.parseInt(args.timeout, 10)
      : 300_000
  const headless = args.headless === "false" ? false : true

  const launchOpts: Record<string, unknown> = {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
    ],
    headless,
  }
  if (args["executable-path"]) {
    launchOpts.executablePath = args["executable-path"]
  }

  console.log(`Launching Chrome (headless=${headless})...`)
  const browser = await launch(launchOpts)
  const page = await browser.newPage()

  const browserErrors: string[] = []
  page.on("pageerror", (err: unknown) => browserErrors.push(String(err)))
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      browserErrors.push(msg.text())
    }
  })

  try {
    console.log(`Loading ${htmlPath} ...`)
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" })

    await page.waitForFunction(
      () =>
        (document.querySelector("#samples") as HTMLElement).textContent!.trim()
          .length > 0,
      { timeout: 15_000 },
    )

    async function setInput(
      id: string,
      val: string | boolean | undefined,
    ): Promise<void> {
      if (val === undefined) {
        return
      }
      await page.$eval(
        `#${id}`,
        (el, v) => {
          ;(el as HTMLInputElement).value = (v as string)
        },
        String(val),
      )
    }
    await setInput("nSync", args["n-sync"])
    await setInput("nAsync", args["n-async"])
    await setInput("nColl", args["n-coll"])

    console.log("Starting benchmark run (runAll())...")
    await page.click("#runBtn")

    await page.waitForFunction(
      () =>
        (document.querySelector("#log") as HTMLElement).textContent!.includes(
          "Done.",
        ),
      { timeout },
    )

    const logText = await page.$eval(
      "#log",
      (el) => (el as HTMLElement).textContent!,
    )

    async function scrapeTable(id: string): Promise<string[][]> {
      return page.$$eval(`#${id} tbody tr`, (rows) =>
        rows.map((tr) =>
          [...tr.children].map((td) => (td as HTMLElement).textContent!.trim()),
        ),
      )
    }
    const headersOf = (id: string): Promise<string[]> =>
      page.$$eval(`#${id} thead th`, (ths) =>
        ths.map((th) => (th as HTMLElement).textContent!.trim()),
      )

    const resultsHeaders = await headersOf("resultsTable")
    const resultsRows = await scrapeTable("resultsTable")
    const collHeaders = await headersOf("collTable")
    const collRows = await scrapeTable("collTable")

    const toObjects = (
      headers: string[],
      rows: string[][],
    ): Record<string, string>[] =>
      rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])))

    const output: BenchOutput = {
      browserErrors,
      collisions: toObjects(collHeaders, collRows),
      htmlPath,
      inputs: {
        nAsync: await page.$eval(
          "#nAsync",
          (el) => (el as HTMLInputElement).value,
        ),
        nColl: await page.$eval(
          "#nColl",
          (el) => (el as HTMLInputElement).value,
        ),
        nSync: await page.$eval(
          "#nSync",
          (el) => (el as HTMLInputElement).value,
        ),
      },
      rawLog: logText,
      results: toObjects(resultsHeaders, resultsRows),
      timestamp: new Date().toISOString(),
      userAgent: await page.evaluate(() => navigator.userAgent),
    }

    return output
  } catch (error) {
    try {
      const shotPath = path.resolve(
        ((typeof args.out === "string"
          ? args.out
          : "benchmark_results.json") as string).replace(/\.json$/, "") +
          "_failure.png",
      )
      await page.screenshot({ path: shotPath, fullPage: true })
      console.error("Saved failure screenshot to " + shotPath)
    } catch {
      /* best-effort */
    }
    throw error
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  let output: BenchOutput
  try {
    output = await runBenchmark(args)
  } catch (error) {
    console.error("Benchmark run failed:", (error as Error).message)
    process.exitCode = 1
    return
  }

  const outPath = path.resolve(
    typeof args.out === "string" ? args.out : "benchmark_results.json",
  )
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

  console.log("\n=== Results ===")
  console.table(output.results)
  console.log("\n=== Collision test ===")
  console.table(output.collisions)
  if (output.browserErrors.length) {
    console.log("\n=== Browser console errors ===")
    for (const e of output.browserErrors) {
      console.log(" -", e)
    }
  }
  console.log(`\nFull JSON written to ${outPath}`)
}

if (process.argv[1] === import.meta.filename) {
  main()
}

export { parseArgs, runBenchmark }
export type { BenchOutput }
