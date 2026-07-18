// Ambient type shim for `bun:sqlite`.
//
// bun:sqlite is provided by the Bun runtime but is not on the node type path
// (tsconfig.scripts pins types to ["node"]). Declaring it in an ambient .d.ts
// (not inside a module) makes the script typecheck without pulling in @types/bun.

declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean })
    run(sql: string, ...params: unknown[]): unknown
    query<T = Record<string, unknown>>(sql: string): {
      get: (...params: unknown[]) => T
      all: (...params: unknown[]) => T[]
      run: (...params: unknown[]) => unknown
    }
    prepare(sql: string): { run: (...params: unknown[]) => unknown }
    close(): void
  }
}
