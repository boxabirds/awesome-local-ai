#!/usr/bin/env bash
# Moved to benchmarks/spec-bench/harness/check-browser.sh. This forwards, so older checkouts, running
# harnesses and existing notes keep working.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../spec-bench/harness" && pwd)/check-browser.sh" "$@"
