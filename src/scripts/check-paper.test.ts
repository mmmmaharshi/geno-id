/// <reference types="node" />

import assert from "node:assert/strict"

import { lintPaperText } from "./check-paper.js"

import path from "node:path"

import { readFileSync } from "node:fs"

import { test } from "node:test"

const __dirname = import.meta.dirname

void test("clean prose and latex ranges report no violations", () => {
  assert.deepEqual(
    lintPaperText("Plain text.\nA range $2.8$--$12.9$ is fine.\n"),
    [],
  )
})

void test("triple dash and unicode dashes report rule and line", () => {
  const hits = lintPaperText("ok\nbad --- here\nworse — here\n")

  assert.equal(hits.length, 2)

  assert.equal(hits[0].line, 2)

  assert.equal(hits[0].rule, "triple-dash")

  assert.equal(hits[1].line, 3)

  assert.equal(hits[1].rule, "unicode-em-dash")
})

void test("checked-in paper.tex is clean", () => {
  const text = readFileSync(
    path.resolve(__dirname, "..", "..", "paper.tex"),
    "utf8",
  )

  assert.deepEqual(lintPaperText(text), [])
})
