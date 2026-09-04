#!/usr/bin/env bash
# Run every test that needs no hardware. Anything requiring a GPU or a model
# pack lives in benchmarks/ instead.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rc=0
for t in "$DIR"/*-test.sh; do
  echo "=============================================================="
  echo "$(basename "$t")"
  echo "=============================================================="
  bash "$t" || rc=1
  echo
done
if (( rc )); then echo "SOME TESTS FAILED"; else echo "ALL TESTS PASSED"; fi
exit $rc
