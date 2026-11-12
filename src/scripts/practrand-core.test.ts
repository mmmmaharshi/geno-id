import assert from "node:assert/strict"
import { test } from "node:test"
import { countVerdicts, parsePractrandOutput } from "./practrand-core.ts"

test("parsePractrandOutput reads the name and both p-values from a result line", () => {
  const rows = parsePractrandOutput("b3 bias corrected      : 0.02 (0.03)")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, "b3 bias corrected")
  assert.equal(rows[0].p, 0.02)
  assert.equal(rows[0].assessedP, 0.03)
  assert.equal(rows[0].verdict, null)
})

test("parsePractrandOutput reads a verdict when the line carries one", () => {
  const rows = parsePractrandOutput("bc bias corrected      : 0.001 (0.002) [unusual]")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].verdict, "unusual")
})

test("parsePractrandOutput ignores lines with no p-value", () => {
  const rows = parsePractrandOutput(
    ["Testing 1G bits...", "seed = 1234", "b3 bias corrected : 0.5 (0.5)"].join("\n"),
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, "b3 bias corrected")
})

test("parsePractrandOutput rejects a p-value outside the unit interval", () => {
  const rows = parsePractrandOutput("bad test : 1.5 (2.5)")
  assert.equal(rows.length, 0)
})

test("parsePractrandOutput reads scientific-notation p-values", () => {
  const rows = parsePractrandOutput("rare test : 1.2e-05 (3.4e-05)")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].p, 1.2e-05)
  assert.equal(rows[0].assessedP, 3.4e-05)
})

test("countVerdicts separates passes, failures, and unassessed rows", () => {
  const rows = parsePractrandOutput(
    [
      "ok test      : 0.5 (0.5) [passed]",
      "odd test     : 0.001 (0.002) [unusual]",
      "quiet test   : 0.4 (0.4)",
    ].join("\n"),
  )
  const counts = countVerdicts(rows)
  assert.equal(counts.passed, 1)
  assert.equal(counts.failed, 1)
  assert.equal(counts.unassessed, 1)
})

test("countVerdicts reports an unassessed row as neither pass nor failure", () => {
  const counts = countVerdicts(parsePractrandOutput("quiet test : 0.4 (0.4)"))
  assert.equal(counts.passed, 0)
  assert.equal(counts.failed, 0)
  assert.equal(counts.unassessed, 1)
})

test("parsePractrandOutput returns no rows for output that carries no results", () => {
  assert.deepEqual(parsePractrandOutput("practrand: command not found"), [])
  assert.deepEqual(parsePractrandOutput(""), [])
})
