import { runExport } from "./dieharder-common.ts"

// Full export for the dieharder battery: 100M bits (12.5MB) per flat generator,
// large enough that dieharder's harder sub-tests don't need to rewind the file
// (which would reuse bits and invalidate p-values). NIST SP 800-22
// (`nist-bridge.py`) validates ~1.22M-bit samples; this is deliberately much
// larger and from an independent test-suite codebase.
const TARGET_BITS = 100_000_000

await runExport(TARGET_BITS)
