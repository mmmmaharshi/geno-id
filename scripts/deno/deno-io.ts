// Shared I/O helper for the Deno export scripts. Deno has no node:fs write in
// the project's Bun/Node scripts, so these ports write via Deno.writeTextFile
// into the Bun-built dist/ directory. Imported by scripts/deno/export-*.ts.

const distDir = new URL("../../dist/", import.meta.url)

// Resolve a dist/<name> output path as a file: URL.
export function distFile(name: string): URL {
  return new URL(name, distDir)
}

// Write a NIST bit-stream text file into dist/. Requires `--allow-write`.
export async function writeBitsFile(name: string, content: string): Promise<URL> {
  const file = distFile(name)
  await Deno.writeTextFile(file, content)
  return file
}
