#!/usr/bin/env bash
# bash benchmarks/gufo-eval/test-test-a.sh -- test-a.sh's failure path, with a fake llama-server.
# 27 Sep: test A's server "did not start" (a wait_up bug), test-a.sh exited and left the server
# running; the benchmark run resumed next to it and the kernel's OOM killer fired. Whatever happens,
# test-a.sh must stop the server it started.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'pkill -f "$T/bin/llama-server" 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/shim" "$T/results"
# a server that starts and never answers
printf '#!/usr/bin/env bash\nexec sleep 300\n' > "$T/bin/llama-server"
# setsid is Linux-only; on macOS, a shim with the same effect (a new session, then exec)
printf '#!/usr/bin/env python3\nimport os,sys\nos.setsid()\nos.execvp(sys.argv[1],sys.argv[1:])\n' > "$T/shim/setsid"
chmod +x "$T/bin/llama-server" "$T/shim/setsid"
command -v setsid >/dev/null || export PATH="$T/shim:$PATH"
LLAMA_BIN="$T/bin" LOAD_TIMEOUT_S=3 RESULTS="$T/results" MODELS="$T" \
  bash "$HERE/test-a.sh" --dry-run > "$T/out.txt" 2>&1
rc=$?
sleep 1
fail=0
[[ $rc -ne 0 ]] || { echo "FAIL: exit $rc for a server that never answered"; fail=1; }
grep -q "did not start" "$T/out.txt" || { echo "FAIL: no 'did not start' message"; cat "$T/out.txt"; fail=1; }
if pgrep -f "$T/bin/llama-server" >/dev/null; then echo "FAIL: test-a.sh left its llama-server running"; fail=1; fi
[[ $fail -eq 0 ]] && echo "ok   test-a.sh: a server that never answers is reported and stopped"

# mtp-depth.sh, same failure path (it runs after test A, from test A's prompts)
mkdir -p "$T/prompts"; echo "x" > "$T/prompts/fill-2048.txt"
LLAMA_BIN="$T/bin" LOAD_TIMEOUT_S=3 IQ4_MODEL="$T/none.gguf" MODELS="$T" RESULTS="$T/results" \
  bash "$HERE/mtp-depth.sh" --prompts "$T/prompts" --fills 2048 --repeats 1 > "$T/depth.txt" 2>&1
rc=$?
sleep 1
f2=0
[[ $rc -ne 0 ]] || { echo "FAIL: mtp-depth.sh exit $rc for servers that never answered"; f2=1; }
[[ $(grep -c "did not start" "$T/depth.txt") -eq 2 ]] || { echo "FAIL: mtp-depth.sh should report both depths"; cat "$T/depth.txt"; f2=1; }
if pgrep -f "$T/bin/llama-server" >/dev/null; then echo "FAIL: mtp-depth.sh left a llama-server running"; f2=1; fi
[[ $f2 -eq 0 ]] && echo "ok   mtp-depth.sh: servers that never answer are reported and stopped"
exit $(( fail | f2 ))
