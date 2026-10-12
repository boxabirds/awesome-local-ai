#!/usr/bin/env bash
# Mini project shell test 2.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$DIR/lib.sh"
assert_ok "true succeeds" true
assert_fails "false fails" false
finish
