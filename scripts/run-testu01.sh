#!/bin/sh
# Local driver for the TestU01 randomness battery.
#
# TestU01 is installed on the host (not in CI) and its output is written to
# a local file. TestU01 is a compiled C++ suite: build it from source
# (https://www.practrand.com/ is unrelated; the suite lives at
# https://github.com/umontreal-simul/ssj/master/TestU01), then point this
# script at the built binary.
#
# Usage: TESTU01_BIN=/path/to/TestU01 ./scripts/run-testu01.sh
#
# The binary must be given explicitly: there is no standard install location,
# and guessing one would silently run the wrong suite or nothing at all.

set -e

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/results/statistics/testu01.txt"

if [ -z "$TESTU01_BIN" ]; then
  echo "TESTU01_BIN is not set." >&2
  echo "Build TestU01 from source, then re-run:" >&2
  echo "  TESTU01_BIN=/path/to/TestU01 ./scripts/run-testu01.sh" >&2
  exit 1
fi

if [ ! -x "$TESTU01_BIN" ]; then
  echo "TestU01 binary not found or not executable: $TESTU01_BIN" >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"

# TestU01's own runner is a shell script shipped with the suite; it drives
# the individual tests and writes their .txt result files into the working
# directory. The suite ships TestU01.sh next to the binary.
runner="$(dirname "$TESTU01_BIN")/TestU01.sh"
if [ ! -x "$runner" ]; then
  echo "TestU01.sh not found next to the binary: $runner" >&2
  exit 1
fi

workdir="$root/dist/testu01"
rm -rf "$workdir"
mkdir -p "$workdir"
cd "$workdir"

# Run the suite's own driver over the default test list.
"$runner" >"$workdir/testu01.log" 2>&1 || {
  echo "TestU01 run failed; see $workdir/testu01.log" >&2
  exit 1
}

{
  echo "## TestU01"
  echo
  echo "Modern randomness suite run on the host (not in CI). Each test writes a"
  echo "result file; the per-test pass/fail lines are reproduced below."
  echo
  cat "$workdir/testu01.log"
} >"$out"

echo "Wrote $out"
