#!/usr/bin/env bash
# tests/lib.sh -- the smallest thing that can fail a build.
#
# These tests exercise logic that has no hardware in it: selection, size and
# version arithmetic, manifest shape. Anything that needs a GPU or a 30 GB
# model pack belongs in benchmarks/, not here.

TESTS_RUN=0; TESTS_FAILED=0

_pass() { TESTS_RUN=$((TESTS_RUN+1)); printf '  ok   %s\n' "$1"; }
_fail() {
  TESTS_RUN=$((TESTS_RUN+1)); TESTS_FAILED=$((TESTS_FAILED+1))
  printf '  FAIL %s\n' "$1"
  printf '         expected: %s\n' "$2"
  printf '         actual:   %s\n' "$3"
}

assert_eq() { # description expected actual
  if [[ "$2" == "$3" ]]; then _pass "$1"; else _fail "$1" "$2" "$3"; fi
}

assert_ok() { # description command...
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then _pass "$d"; else _fail "$d" "exit 0" "exit $?"; fi
}

assert_fails() { # description command...
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then _fail "$d" "non-zero exit" "exit 0"; else _pass "$d"; fi
}

finish() {
  echo
  if (( TESTS_FAILED )); then
    echo "${TESTS_FAILED} of ${TESTS_RUN} checks FAILED"
    exit 1
  fi
  echo "all ${TESTS_RUN} checks passed"
}
