import cloudflare from "@cloudflare/oxlint-config"
import { defineConfig } from "oxlint"
import core from "ultracite/oxlint/core"
import gdp from "ultracite/oxlint/gdp"
import landmines from "ultracite/oxlint/landmines"

export default defineConfig({
  env: cloudflare.env,
  extends: [core, cloudflare, landmines, gdp],
  ignorePatterns: [
    ...new Set([...core.ignorePatterns, ...cloudflare.ignorePatterns, "src/scripts/deno/**"]),
  ],
  jsPlugins: [...landmines.jsPlugins, ...gdp.jsPlugins],
  overrides: [
    {
      files: ["src/**/*.ts"],
      rules: {
        "gdp-ts/no-type-assertion": "off",
        "landmines-style/no-comments": "off",
        "landmines-types/no-explicit-return-types": "off",
        "one-var": "off",
        "quality/no-array-filter-map": "off",
        "quality/no-chained-type-assertions": "off",
        "quality/no-conditional-empty-object-spread": "off",
        "quality/no-known-value-widening": "off",
        "quality/no-object-parameters": "off",
        "quality/no-reduce-accumulator-copy": "off",
        "quality/no-reflect-apply": "off",
        "quality/no-reflect-get": "off",
        "quality/no-unknown-returns": "off",
        "quality/no-unknown-type-aliases": "off",
        "quality/no-unsafe-dictionary-type": "off",
        "quality/no-widen-then-assert": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "unicorn/consistent-function-scoping": "off",
      },
    },
    {
      files: ["src/**/*.test.ts"],
      rules: {
        "landmines-structure/colocated-tests": "off",
        "landmines-testing/no-flake-masking": "off",
        "landmines-testing/no-test-doubles": "off",
      },
    },
    {
      files: ["src/scripts/evidence-fixture.ts"],
      rules: {
        "landmines-structure/test-file-names": "off",
      },
    },
    {
      files: ["src/scripts/**/*.ts", "src/benchmark.ts"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["src/scripts/run-dieharder.ts"],
      rules: {
        "typescript/strict-void-return": "off",
      },
    },
    {
      files: ["*.config.ts"],
      rules: {
        "typescript/no-unsafe-call": "off",
      },
    },
  ],
  plugins: [...new Set([...core.plugins, ...cloudflare.plugins])],
  rules: {
    "typescript/array-type": ["error", { default: "array" }],
  },
})
