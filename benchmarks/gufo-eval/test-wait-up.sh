#!/usr/bin/env bash
# bash benchmarks/gufo-eval/test-wait-up.sh -- wait_up must succeed once the server answers, even
# after polling (27 Sep: it returned the until-loop body's last status, 1, and test A "did not start").
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0
for script in test-a.sh mtp-depth.sh; do
  fn="$(sed -n '/^wait_up() {/,/^}/p' "$HERE/$script")"
  result=$(bash -c "
    PORT=1; LOAD_TIMEOUT_S=60; sleep() { :; }
    calls=0; curl() { calls=\$((calls+1)); [ \$calls -ge 3 ]; }
    /bin/sleep 30 & SPID=\$!
    $fn
    wait_up && echo up || echo down
    kill \$SPID 2>/dev/null")
  if [[ "$result" == up ]]; then echo "ok   $script"; else echo "FAIL $script: wait_up said '$result' for a server that answered on the 3rd poll"; fail=1; fi
done
exit $fail
