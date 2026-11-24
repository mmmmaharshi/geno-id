declare module "bun:sqlite" {
  export class Database {
    public constructor(filename: string, options?: { readonly?: boolean })
    public exec(sql: string): void
    public run(sql: string, ...params: readonly unknown[]): unknown
    public query<Type = Record<string, unknown>>(
      sql: string
    ): {
      get: (...params: readonly unknown[]) => Type
      all: (...params: readonly unknown[]) => Type[]
      run: (...params: readonly unknown[]) => unknown
    }
    public prepare(sql: string): {
      run: (...params: readonly unknown[]) => unknown
      get: (...params: readonly unknown[]) => unknown
    }
    public close(): void
  }
}
