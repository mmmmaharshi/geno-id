# Lint policy

## Scope

`bun run lint` runs oxlint with TypeScript information. It enables all 539 rules from the project's eight plugins. The base configuration disables no rule.

The Deno ports stay outside oxlint and the scripts typecheck. CI checks them with Deno.

## Context overrides

Some rules conflict with a deliberate project contract. The configuration changes these rules only in the listed context.

| Context | Rules | Reason |
|---|---|---|
| `src/**/*.ts` | `import/no-named-export`, `import/no-relative-parent-imports`, `import/exports-last`, `import/group-exports` | The library exposes named ESM exports and keeps each domain next to its implementation. |
| `src/**/*.ts` | `oxc/no-async-await` | WebCrypto, workers, timers, and database drivers require async functions. |
| `src/**/*.ts` | `typescript/no-unsafe-type-assertion` | Dynamic `dist` imports, test fixtures, and overloaded helper boundaries need explicit narrowing. |
| `src/**/*.ts` | `typescript/prefer-optional-chain` | The restriction rule `oxc/no-optional-chaining` stays enabled, so explicit null checks are the project convention. |
| `src/scripts/**/*.ts` | `id-length`, `no-magic-numbers`, `no-underscore-dangle` | Benchmark fixtures, counters, and bit masks are clearer with short names and literal values. |
| `src/scripts/**/*.ts` | `node/no-process-env`, `node/no-sync`, `typescript/prefer-readonly-parameter-types` | CLI configuration, deterministic artifact writes, and mutable benchmark inputs are deliberate. |
| `src/scripts/*.d.ts` | `import/unambiguous` | Ambient module declarations stay script-shaped so TypeScript registers `bun:sqlite`. |
| `src/scripts/run-dieharder.ts` | `typescript/strict-void-return` | Node's `execFile` overload returns a child process while its callback API reports completion through the callback. |
| `*.config.ts` | `import/no-default-export`, `typescript/no-unsafe-call`, `typescript/no-unsafe-argument` | Oxlint and oxfmt require a default config export and load these files outside the source tsconfig. |

The Node built-in module allowlist covers the CLI and test imports. The numeric ignore list covers UUID bit widths, masks, statistical constants, and benchmark sizes. The readonly-parameter allowlist covers mutable buffers, collections, and the workload accumulator. New numeric literals outside that list still fail. Size limits stay enabled at 5,000 lines per file and 400 lines per function.

## Inline suppressions

Inline lint and TypeScript suppressions are forbidden. Fix the code or add a reviewed context override with a reason in this document.
