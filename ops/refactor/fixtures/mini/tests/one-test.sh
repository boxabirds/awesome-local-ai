#!/usr/bin/env bash
# Mini project shell test 1: the helpers of tests/lib.sh in use.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/lib.sh"
assert_eq "arithmetic" "4" "$((2 + 2))"
finish
