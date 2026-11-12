// Output parsing for the PractRand battery.
//
// PractRand writes a line per test, with the test name, the unassessed
// p-value, and the assessed p-value in parentheses:
//
//   b3 bias corrected      : 0.02 (0.03)
//
// The parser is deliberately tolerant of the surrounding layout and strict
// about the numbers: a row is only accepted when a p-value in [0, 1] is
// found, so a line that does not carry a p-value cannot be counted as a
// pass. A run whose output yields no rows at all is a failure, not an
// empty pass.

export interface PractRandRow {
  name: string
  /** p-value as reported before assessment. */
  p: number
  /** p-value after PractRand's own assessment. */
  assessedP: number
  /** PractRand's verdict, when the line carries one. */
  verdict: string | null
}

const ROW_RE = /^\s*(.+?)\s*:\s*([0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?)\s*\(\s*([0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?)\s*\)\s*(.*)$/

const VERDICT_RE = /\[(unusual|very unusual|extremely unusual|FAILED|failed|PASSED|passed)\]/

export function parsePractrandOutput(output: string): PractRandRow[] {
  const rows: PractRandRow[] = []
  for (const line of output.split("\n")) {
    const match = ROW_RE.exec(line)
    if (!match) continue
    const p = Number(match[2])
    const assessedP = Number(match[3])
    if (!Number.isFinite(p) || !Number.isFinite(assessedP)) continue
    if (p < 0 || p > 1 || assessedP < 0 || assessedP > 1) continue
    const verdict = VERDICT_RE.exec(match[4] ?? "")
    rows.push({
      name: match[1].trim(),
      p,
      assessedP,
      verdict: verdict ? verdict[1] : null,
    })
  }
  return rows
}

/**
 * A row is a failure when PractRand reports an unusual result. A row with
 * no verdict is not a pass either: it is counted as unassessed, so a run
 * that produced unparseable output cannot be reported as clean.
 */
export function countVerdicts(rows: readonly PractRandRow[]): {
  passed: number
  failed: number
  unassessed: number
} {
  let passed = 0
  let failed = 0
  let unassessed = 0
  for (const row of rows) {
    if (row.verdict === null) unassessed++
    else if (/unusual|failed/i.test(row.verdict)) failed++
    else passed++
  }
  return { passed, failed, unassessed }
}
