import { nullValue } from "./shared/runtime-values.ts"

// Output parsing for the PractRand battery.

//

// PractRand writes a line per test, with the test name, the unassessed

// P-value, and the assessed p-value in parentheses:

//

//   B3 bias corrected      : 0.02 (0.03)

//

// The parser is deliberately tolerant of the surrounding layout and strict

// About the numbers: a row is only accepted when a p-value in [0, 1] is

// Found, so a line that does not carry a p-value cannot be counted as a

// Pass. A run whose output yields no rows at all is a failure, not an

// Empty pass.

export interface PractRandRow {
  name: string

  /** P-value as reported before assessment. */

  p: number

  /** P-value after PractRand's own assessment. */

  assessedP: number

  /** PractRand's verdict, when the line carries one. */

  verdict: string | null
}

const ROW_RE =
  /^\s*(?<name>.+?)\s*:\s*(?<value>[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?)\s*\(\s*(?<pct>[0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?)\s*\)\s*(?<rest>.*)$/u

const VERDICT_RE =
  /\[(?<verdict>unusual|very unusual|extremely unusual|FAILED|failed|PASSED|passed)\]/u

export const parsePractrandOutput = (output: string): PractRandRow[] => {
  const rows: PractRandRow[] = []

  for (const line of output.split("\n")) {
    const match = ROW_RE.exec(line)

    if (match) {
      const p = Number(match[2])

      const assessedP = Number(match[3])

      if (
        Number.isFinite(p) &&
        Number.isFinite(assessedP) &&
        p >= 0 &&
        p <= 1 &&
        assessedP >= 0 &&
        assessedP <= 1
      ) {
        const verdictMatch = VERDICT_RE.exec(match[4])

        let verdict: string | null = nullValue

        if (verdictMatch) {
          const [, text] = verdictMatch
          verdict = text
        }

        rows.push({
          assessedP,

          name: match[1].trim(),

          p,

          verdict,
        })
      }
    }
  }

  return rows
}

/**
 * A row is a failure when PractRand reports an unusual result. A row with
 * no verdict is not a pass either: it is counted as unassessed, so a run
 * that produced unparseable output cannot be reported as clean.
 *
 * @param {readonly PractRandRow[]} rows Parsed PractRand rows.
 * @returns {{ passed: number; failed: number; unassessed: number }} Counts of passed, failed, and unassessed rows.
 */

export const countVerdicts = (
  rows: readonly PractRandRow[]
): {
  passed: number

  failed: number

  unassessed: number
} => {
  let passed = 0

  let failed = 0

  let unassessed = 0

  for (const row of rows) {
    if (row.verdict === nullValue) {
      unassessed += 1
    } else if (/unusual|failed/iu.test(row.verdict)) {
      failed += 1
    } else {
      passed += 1
    }
  }

  return { failed, passed, unassessed }
}
