import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { verifyEvidenceTree } from "./verify-evidence-core.ts"

function fixture(): { dir: string; write: (rel: string, body: string) => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "evidence-"))
  return {
    dir,
    write(rel, body) {
      const abs = path.join(dir, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, body, "utf-8")
    },
  }
}

test("every mapped artifact present verifies", () => {
  const f = fixture()
  try {
    f.write("results/a.json", "{}")
    const result = verifyEvidenceTree(
      {
        package_version: "1.2.3",
        artifacts: {
          one: { artifact: "results/a.json" },
        },
      },
      f.dir,
    )
    assert.equal(result.missing.length, 0)
    assert.equal(result.checked, 1)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a missing mapped artifact is reported", () => {
  const f = fixture()
  try {
    const result = verifyEvidenceTree(
      { package_version: "1.2.3", artifacts: { one: { artifact: "results/gone.json" } } },
      f.dir,
    )
    assert.equal(result.missing.length, 1)
    assert.equal(result.missing[0].id, "one")
    assert.equal(result.missing[0].spec, "results/gone.json")
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a comma-separated list of artifacts is checked element by element", () => {
  const f = fixture()
  try {
    f.write("results/a.json", "{}")
    const result = verifyEvidenceTree(
      {
        package_version: "1.2.3",
        artifacts: { one: { artifact: "results/a.json, results/gone.json" } },
      },
      f.dir,
    )
    assert.equal(result.checked, 2)
    assert.equal(result.missing.length, 1)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a glob resolves to the files that match it", () => {
  const f = fixture()
  try {
    f.write("golden/one.txt", "a")
    f.write("golden/two.txt", "b")
    f.write("golden/other.md", "c")
    const result = verifyEvidenceTree(
      { package_version: "1.2.3", artifacts: { one: { artifact: "golden/*.txt" } } },
      f.dir,
    )
    assert.equal(result.missing.length, 0)
    assert.equal(result.checked, 1)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a glob that matches nothing is missing", () => {
  const f = fixture()
  try {
    f.write("golden/one.md", "a")
    const result = verifyEvidenceTree(
      { package_version: "1.2.3", artifacts: { one: { artifact: "golden/*.txt" } } },
      f.dir,
    )
    assert.equal(result.missing.length, 1)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a version mismatch between the manifest and the package is an error", () => {
  const f = fixture()
  try {
    f.write("results/a.json", "{}")
    const result = verifyEvidenceTree(
      { package_version: "1.2.3", packageVersionFromPackage: "1.2.4", artifacts: { one: { artifact: "results/a.json" } } },
      f.dir,
    )
    assert.equal(result.versionError, "manifest package_version 1.2.3 != package.json 1.2.4")
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})

test("a version mismatch inside the release identity is an error", () => {
  const f = fixture()
  try {
    f.write("results/a.json", "{}")
    const result = verifyEvidenceTree(
      {
        package_version: "1.2.3",
        releaseIdentityVersion: "1.0.0",
        artifacts: { one: { artifact: "results/a.json" } },
      },
      f.dir,
    )
    assert.match(result.versionError ?? "", /release identity 1\.0\.0 != package\.json 1\.2\.3/)
  } finally {
    rmSync(f.dir, { recursive: true, force: true })
  }
})
