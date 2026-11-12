// Shared I/O helper for the Deno export scripts. Deno has no node:fs write in
// the project's Bun/Node scripts, so these ports write via Deno.writeTextFile
// into the Bun-built dist/ directory. Imported by src/scripts/deno/export-*.ts.

const distDir = new URL("../../../dist/", import.meta.url)

// Write a NIST bit-stream text file into dist/. Requires `--allow-write`.
export async function writeBitsFile(name: string, content: string): Promise<URL> {
  const file = new URL(name, distDir)
  await Deno.writeTextFile(file, content)
  return file
}
