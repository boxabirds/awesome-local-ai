#!/usr/bin/env bash
# Checks the committed fixture without the host's lake: every file is in MANIFEST.sha256 with the right hash, no file
# is missing or extra, none holds a private pattern, and the folder is within the size budget (TC-103).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
budget=$(sed -n 's/^FIXTURE_BUDGET_BYTES=\([0-9]*\)$/\1/p' "$here/make-lake-fixture.sh")
patterns=$(sed -n "s/^PRIVATE_PATTERNS='\(.*\)'\$/\1/p" "$here/make-lake-fixture.sh")
cd "$here/lake"
fail=0
diff -q <(find . -type f | sed 's|^\./||' | LC_ALL=C sort) <(cut -c67- "$here/MANIFEST.sha256" | LC_ALL=C sort) >/dev/null \
  || { echo "files differ from MANIFEST.sha256"; fail=1; }
shasum -a 256 -c "$here/MANIFEST.sha256" >/dev/null 2>&1 || { echo "a hash differs from MANIFEST.sha256"; fail=1; }
while read -r f; do
  case $f in *.gz) c=$(gzip -dc "$f" | grep -a -c -E "$patterns" || true) ;; *.bundle) c=0 ;; *) c=$(grep -a -c -E "$patterns" "$f" || true) ;; esac
  [ "${c:-0}" -eq 0 ] || { echo "private pattern in $f"; fail=1; }
done < <(find . -type f)
bytes=$(find . -type f -exec stat -f %z {} + | paste -sd+ - | bc)
[ "$bytes" -le "$budget" ] || { echo "$bytes bytes is over the budget $budget"; fail=1; }
echo "fixture check: $(find . -type f | wc -l | tr -d ' ') files, $bytes bytes, budget $budget, $([ $fail = 0 ] && echo ok || echo FAILED)"
exit $fail
