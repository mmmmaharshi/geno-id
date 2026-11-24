# Lint policy

## Scope

`bun run lint` runs type-aware oxlint through [`tsrs`](https://oxc.rs/blog/2026-11-17/faster-type-aware-linting-with-tsrs). The config extends `ultracite/oxlint/core`, `@cloudflare/oxlint-config`, `ultracite/oxlint/landmines`, and `ultracite/oxlint/gdp`.

`@interfere/landmines` stays at `0.1.1`: later releases removed the `/structure`, `/style`, `/testing`, and `/types` subpaths the Ultracite preset imports.

Deno ports stay outside oxlint and the scripts typecheck. `src/scripts/deno/**` is ignored; CI checks the ports with Deno.

## Context overrides

The presets cover the project. These narrow overrides keep the existing public and benchmark contracts.

| Context | Rules | Reason |
|---|---|---|
| `**/*.ts` | `typescript/array-type` | The project uses `T[]` and `readonly T[]`; the preset defaults to `Array<T>`. |
| `src/**/*.ts` | `typescript/no-unsafe-type-assertion`, `gdp-ts/no-type-assertion` | Dynamic `dist` imports, test fixtures, and overloaded helper boundaries need explicit narrowing. |
| `src/**/*.ts` | `landmines-style/no-comments`, `landmines-types/no-explicit-return-types` | The project keeps explanatory comments and declares public return types. |
| `src/**/*.ts` | `quality/*` | Benchmark and CLI boundaries parse generated JSON and SQLite rows; these custom quality rules assume fully typed application boundaries. |
| `src/**/*.ts` | `unicorn/consistent-function-scoping`, `one-var` | Generator closures stay next to their state, and grouped declarations match the benchmark code. |
| `src/**/*.test.ts` | `landmines-structure/colocated-tests`, `landmines-testing/no-flake-masking`, `landmines-testing/no-test-doubles` | Tests live centrally in `src/scripts`, use explicit timeouts on CPU-heavy invariants, and inject clocks and browser launchers. |
| `src/scripts/evidence-fixture.ts` | `landmines-structure/test-file-names` | This is a fixture generator script, not test data. |
| `src/scripts/**/*.ts`, `src/benchmark.ts` | `no-console` | CLI and browser benchmark entry points report results through stdout. |
| `src/scripts/run-dieharder.ts` | `typescript/strict-void-return` | Node's `execFile` overload returns a child process while its callback API reports completion through the callback. |
| `*.config.ts` | `typescript/no-unsafe-call` | Oxlint and oxfmt load these files outside the source tsconfig. |

## Inline suppressions

Inline lint and TypeScript suppressions are forbidden. Fix the code or add a reviewed context override with a reason in this document.
