#!/usr/bin/env bash
# version-at-least.sh <have> <minimum> -- exit 0 if version <have> is <minimum> or newer, else 1.
# Versions are dotted numbers ("0.6.1", "24.15.0", "1.98"); anything before the first digit ("v24.15.0",
# "bubblewrap 0.6.1") and after the numbers ("1.98.0-nightly") is ignored. A missing part counts as 0.
set -uo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 <have> <minimum>" >&2; exit 2; }
numbers() { sed -E 's/^[^0-9]*//; s/[^0-9.].*$//' <<<"$1"; }
have="$(numbers "$1")"; min="$(numbers "$2")"
[[ -n "$have" && -n "$min" ]] || exit 1
IFS=. read -r -a h <<<"$have"; IFS=. read -r -a m <<<"$min"
for i in 0 1 2 3; do
  a="${h[i]:-0}"; b="${m[i]:-0}"
  (( 10#$a > 10#$b )) && exit 0
  (( 10#$a < 10#$b )) && exit 1
done
exit 0
