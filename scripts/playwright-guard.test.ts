import { test } from "node:test"
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"

// results/benchmark_results.json is a tracked artifact carrying the browser
// benchmark. The runner used to write it unconditionally, so a run in which
// every browser failed to launch replaced three real engine records with
// `{"runs": []}` and destroyed the evidence. These tests pin the guard.

const root = path.resolve(import.meta.dirname, "..")
const mod = (await import(pathToFileURL(path.resolve(root, "scripts", "playwright.ts")).href)) as {
  planPlaywrightWrite: (runCount: number, outPath: string) => { write: boolean; message: string }
}

const { planPlaywrightWrite } = mod
const OUT = "results/benchmark_results.json"

test("zero successful browsers refuses the write and names the untouched file", () => {
  const plan = planPlaywrightWrite(0, OUT)
  assert.equal(plan.write, false)
  assert.match(plan.message, /left untouched/)
  assert.match(plan.message, new RegExp(OUT.replace(/[.]/g, "[.]")))
})

test("at least one successful browser writes normally", () => {
  const plan = planPlaywrightWrite(1, OUT)
  assert.equal(plan.write, true)
  assert.match(plan.message, /Full JSON written to/)
})

test("a partial run still writes rather than discarding the engines that did work", () => {
  // Two of three engines succeeded: the recorded evidence is real and must
  // be kept, with the failure surfacing through the exit code instead.
  const plan = planPlaywrightWrite(2, OUT)
  assert.equal(plan.write, true)
})

test("an explicit scratch --out does not change the decision, only the path", () => {
  const guarded = planPlaywrightWrite(0, "/tmp/scratch.json")
  assert.equal(guarded.write, false)
  assert.match(guarded.message, /scratch[.]json/)
})