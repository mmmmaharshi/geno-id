import { runExport } from "./dieharder-common.ts"

// Fast local smoke variant: 200K bits (~25KB) per generator — just enough to
// exercise the export / bit-packing path end-to-end without waiting on the
// full 12.5MB export. Not enough for meaningful dieharder p-values.
const TARGET_BITS = 200_000

await runExport(TARGET_BITS)
