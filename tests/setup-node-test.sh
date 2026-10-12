#!/usr/bin/env bash
# setup-node.sh: prepares a machine to run a benchmark pack. Runs the real script (and the real helper scripts beside it) in a
# temporary copy of the harness, with a restricted PATH of stand-in tools, a local stand-in for the private repo's URL, a
# fake `uname` (so both the macOS and the Linux branches run) and, for the "install it now?" prompt, a pseudo-terminal. Nothing
# is installed, no network is used and nothing outside the temporary directory is touched.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

REAL_HARNESS="$REPO_ROOT/benchmarks/spec-bench/harness"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
REAL_PY="$(python3 -c 'import sys; print(sys.executable)')"

# --- the world: stand-in tools -------------------------------------------------------------------------------------------------
BIN="$TMP/bin"; mkdir -p "$BIN"
for t in bash sh git sed tr ls head awk sort uname_real dirname cat mkdir stat basename grep xargs tar mktemp rm cp ln printf date env wc tail chmod \
         cut find touch ldd; do
  p="$(command -v "$t" 2>/dev/null)" && [[ -n "$p" ]] && ln -sf "$p" "$BIN/$t"
done
ln -sf "$REAL_PY" "$BIN/python3"
# SHELL_TRACE=<file>: every line the script under test runs is appended to it (kcov does not run on macOS; see ops/refactor)
if [[ -n "${SHELL_TRACE:-}" ]]; then
  REAL_BASH="$(command -v bash)"; rm -f "$BIN/bash"
  printf '#!/bin/sh\nexec 9>>"%s"\nBASH_XTRACEFD=9 PS4="+L\\${BASH_SOURCE}:\\${LINENO}:" exec "%s" -x "$@"\n' "$SHELL_TRACE" "$REAL_BASH" > "$BIN/bash"; chmod +x "$BIN/bash"
fi
mk() { printf '%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }       # mk <name> <script body>
mk uname 'case "$1" in -m) echo "${FAKE_ARCH:-x86_64}" ;; *) echo "${FAKE_UNAME:-Darwin}" ;; esac'
mk node 'echo "v${FAKE_NODE:-22.1.0}"'
mk uv 'if [ "$2" = "--quiet" ] && [ "$3" = "preflight.py" ]; then echo "preflight with: $*" >> "${FAKE_LOG:-/dev/null}"; exit "${FAKE_PREFLIGHT_RC:-0}"; fi; exit 0'
mk rsync 'exit 0'
mk cargo 'echo "cargo ${FAKE_CARGO:-1.98.0} (abc 2026-01-01)"'
mk bwrap 'echo "bubblewrap ${FAKE_BWRAP:-0.9.0}"'
mk sandbox-exec 'exit 0'
mk npm 'exit "${FAKE_NPM_RC:-0}"'
mk brew 'echo "brew $*" >> "${FAKE_LOG:-/dev/null}"; echo 22.1.0 > "$FAKE_NODE_UPGRADED"'
mk bun 'exit 0'
mk claude 'exit 0'
mk pi 'exit 0'
PLAIN_PATH="$BIN"

# --- a fake public repo (with an origin and an identity) beside a private one --------------------------------------------------
GITCONFIG="$TMP/gitconfig"

build() {  # build <dir> : the public repo at <dir>/pub, a copy of the harness scripts, and what the scenario knobs ask for
  local d="$1" h="$1/pub/benchmarks/spec-bench/harness"
  mkdir -p "$h" "$d/pub/benchmarks/vidi" "$d/pub/benchmarks/reference"
  cp "$REAL_HARNESS"/*.py "$REAL_HARNESS"/*.sh "$h/"
  printf '#!/usr/bin/env bash\necho "browser ok for $1 ${2:-}"\n[ -z "$FAKE_BROWSER_FAIL" ] || { echo "browser failed" ; exit 1; }\n' > "$h/ensure-browser.sh"
  printf 'import sys\nsys.exit(0)\n' > "$h/preflight.py"
  printf '#!/usr/bin/env bash\necho "stack $1 registered"\n' > "$d/pub/benchmarks/reference/install-stack.sh"
  chmod +x "$h"/*.sh "$d/pub/benchmarks/reference/install-stack.sh"
  echo "${BENCH_JSON:-{\"name\": \"vidi\", \"pack_ref\": \"vidi-v1\", \"tools\": [\"bun\"]\}}" > "$d/pub/benchmarks/vidi/bench.json"
  [[ -n "${WITH_SUITE:-}" ]] && mkdir -p "$d/pub/benchmarks/vidi/acceptance/tests"
  git init -q -b main "$d/pub"; git -C "$d/pub" add -A; git -C "$d/pub" commit -q -m seed
  [[ -z "${NO_ORIGIN:-}" ]] && { git init -q --bare -b main "$d/origin.git"; git -C "$d/pub" remote add origin "$d/origin.git"; git -C "$d/pub" push -q origin main; }
  # the private pack repo, reachable through the URL setup-node.sh clones from
  if [[ -n "${PRIVATE_EXISTS:-}" || -z "${PRIVATE_UNREACHABLE:-}" ]]; then
    git init -q -b main "$d/seed-private"; echo p > "$d/seed-private/f"; git -C "$d/seed-private" add -A; git -C "$d/seed-private" commit -q -m seed
    git -C "$d/seed-private" tag vidi-v1
    git init -q --bare -b main "$d/private-origin.git"; git -C "$d/seed-private" push -q "$d/private-origin.git" main --tags
  fi
  : > "$GITCONFIG"
  if [[ -z "${NO_IDENTITY:-}" ]]; then git config --file "$GITCONFIG" user.name "A Tester"; git config --file "$GITCONFIG" user.email "t@t"; fi
  git config --file "$GITCONFIG" "url.$d/private-origin.git.insteadOf" "git@github.com:boxabirds/awesome-local-ai-bench-private.git"
  [[ -n "${PRIVATE_EXISTS:-}" ]] && git clone -q "$d/private-origin.git" "$d/awesome-local-ai-bench-private"
  mkdir -p "$d/home"
}

run() {  # run <dir> args... : sets RC, OUT; the scenario knobs are in the environment
  local d="$1"; shift
  ( cd "$d" && HOME="$d/home" PATH="$PLAIN_PATH" GIT_CONFIG_GLOBAL="$GITCONFIG" GIT_CONFIG_NOSYSTEM=1 FAKE_LOG="$d/log" FAKE_NODE_UPGRADED="$d/node-upgraded" \
      OS_RELEASE="${OS_RELEASE_FILE:-/nonexistent}" bash "$d/pub/benchmarks/spec-bench/harness/setup-node.sh" "$@" ) >"$d/out" 2>&1 < /dev/null
  RC=$?; OUT="$(cat "$d/out")"
}
contains() { [[ "$1" == *"$2"* ]]; }
fresh() { rm -rf "$TMP/w"; mkdir -p "$TMP/w"; build "$TMP/w"; W="$TMP/w"; }

# a pseudo-terminal run: answers is what is typed at each prompt
run_tty() {  # run_tty <dir> <answers> : sets RC, OUT
  local d="$1" answers="$2"
  ( cd "$d" && HOME="$d/home" PATH="$PLAIN_PATH" GIT_CONFIG_GLOBAL="$GITCONFIG" GIT_CONFIG_NOSYSTEM=1 FAKE_LOG="$d/log" FAKE_NODE_UPGRADED="$d/node-upgraded" \
      OS_RELEASE=/nonexistent ANSWERS="$answers" "$REAL_PY" - "$d/pub/benchmarks/spec-bench/harness/setup-node.sh" "$BIN/bash" <<'PY'
import os, pty, sys, time
script, bash = sys.argv[1], sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    os.execv(bash, [bash, script])
answers = os.environ["ANSWERS"].split(",") if os.environ["ANSWERS"] else []
out = b""
while True:
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
    if b"[y/N]" in chunk and answers:
        os.write(fd, (answers.pop(0) + "\n").encode())
_, status = os.waitpid(pid, 0)
open("tty.out", "wb").write(out)
sys.exit(os.waitstatus_to_exitcode(status))
PY
  ); RC=$?
  OUT="$(cat "$d/tty.out" 2>/dev/null)"
}

# =====================================================================================================================================
echo "options"
fresh
run "$W" --help
assert_eq "--help exits 0" "0" "$RC"
assert_ok "and prints the header from the script" contains "$OUT" "setup-node.sh -- prepare this machine"
run "$W" -h
assert_eq "-h exits 0" "0" "$RC"
run "$W" --bogus
assert_eq "an unknown option exits 2" "2" "$RC"
assert_ok "and says which" contains "$OUT" "unknown option --bogus"

echo "a ready machine (macOS)"
fresh
FAKE_UNAME=Darwin run "$W"
assert_eq "everything present: exit 0" "0" "$RC"
assert_ok "git is found" contains "$OUT" "ok    git"
assert_ok "node's version is checked against the minimum" contains "$OUT" "needs 20 or newer"
assert_ok "sandbox-exec is needed on macOS" contains "$OUT" "ok    sandbox-exec"
assert_ok "bubblewrap is not asked of macOS" test -z "$(echo "$OUT" | grep bwrap)"
assert_ok "the pack's own tools (bun) are checked" contains "$OUT" "ok    bun"
assert_ok "the public repo is reachable" contains "$OUT" "public repo reachable"
assert_ok "the git identity is shown" contains "$OUT" "git identity A Tester <t@t>"
assert_ok "the private pack is cloned" contains "$OUT" "cloned the private pack to"
assert_ok "and pinned at the pack's ref" contains "$OUT" "pack at vidi-v1"
assert_ok "a pack with no held-out tests says so" contains "$OUT" "none for benchmarks/vidi (acceptance is reported n/a)"
assert_ok "the preflight ran" contains "$(cat "$W/log")" "preflight with:"
assert_ok "and the last line is ready" contains "$OUT" "ready"

echo "a ready machine (Linux)"
fresh
FAKE_UNAME=Linux run "$W"
assert_eq "exit 0" "0" "$RC"
assert_ok "bubblewrap is checked on Linux" contains "$OUT" "bubblewrap 0.9.0 (needs 0.6.1 or newer)"
assert_ok "sandbox-exec is not" test -z "$(echo "$OUT" | grep sandbox-exec)"

echo "versions too old"
fresh
FAKE_UNAME=Linux FAKE_NODE=18.0.0 FAKE_BWRAP=0.5.0 FAKE_CARGO=1.70.0 run "$W"
assert_eq "old node, bubblewrap and cargo: exit 1" "1" "$RC"
assert_ok "node is named with its version" contains "$OUT" "MISSING node >= 20 (have v18.0.0)"
assert_ok "bubblewrap too" contains "$OUT" "MISSING bwrap >= 0.6.1"
assert_ok "cargo too" contains "$OUT" "MISSING cargo >= 1.77"
assert_ok "all the problems are listed, not just the first" contains "$OUT" "not ready: 3 problem(s) above"

echo "tools that are missing"
fresh
rm "$BIN/git" "$BIN/rsync" "$BIN/uv" "$BIN/node" "$BIN/cargo" "$BIN/bun"
run "$W"
assert_eq "exit 1" "1" "$RC"
for t in uv rsync "node >= 20" "cargo >= 1.77" bun; do assert_ok "$t is reported missing" contains "$OUT" "MISSING $t"; done
fresh >/dev/null 2>&1 || true
# restore the tools for the scenarios below
for t in git; do p="$(command -v "$t")"; ln -sf "$p" "$BIN/$t"; done
mk node 'echo "v${FAKE_NODE:-22.1.0}"'; mk uv 'if [ "$2" = "--quiet" ] && [ "$3" = "preflight.py" ]; then echo "preflight with: $*" >> "${FAKE_LOG:-/dev/null}"; exit "${FAKE_PREFLIGHT_RC:-0}"; fi; exit 0'
mk rsync 'exit 0'; mk cargo 'echo "cargo ${FAKE_CARGO:-1.98.0} (abc 2026-01-01)"'; mk bun 'exit 0'

echo "cargo only on ~/.cargo/bin"
fresh
rm "$BIN/cargo"; mkdir -p "$W/home/.cargo/bin"; printf '#!/bin/sh\necho "cargo 1.98.0"\n' > "$W/home/.cargo/bin/cargo"; chmod +x "$W/home/.cargo/bin/cargo"
run "$W"
assert_eq "cargo found in ~/.cargo/bin after the PATH is searched" "0" "$RC"
mk cargo 'echo "cargo ${FAKE_CARGO:-1.98.0} (abc 2026-01-01)"'

echo "the pack's tools"
BENCH_JSON='{"name": "vidi"}' fresh
run "$W"
assert_ok "a pack with no tools and no pack_ref needs neither" contains "$OUT" "has no pack_ref in bench.json: it runs from this repo, no private pack needed"
BENCH_JSON='{"name": "vidi", "pack_ref": "", "tools": ["nosuchtool"]}' fresh
run "$W"
assert_eq "a tool the pack names that is missing exits 1" "1" "$RC"
assert_ok "with a pointer to the pack's README" contains "$OUT" "MISSING nosuchtool -- install: the benchmarks/vidi pack's builds need it"
fresh
rm "$W/pub/benchmarks/vidi/bench.json"
run "$W"
assert_ok "an unreadable bench.json gives no pack ref and no tools (the script does not stop)" contains "$OUT" "no pack_ref in bench.json"
fresh
FAKE_UNAME=Darwin run "$W" --pack benchmarks/vidi/ --pack-ref vidi-v1
assert_eq "--pack (with a trailing slash) and --pack-ref are accepted" "0" "$RC"

echo "the repos"
NO_ORIGIN=1 fresh
run "$W"
assert_eq "no origin on the public repo: exit 1" "1" "$RC"
assert_ok "and what is missing is push access" contains "$OUT" "MISSING push access to the public repo's origin"
rm -rf "$TMP/w"; mkdir "$TMP/w"; NO_IDENTITY=1 build "$TMP/w"; W="$TMP/w"
run "$W"
assert_eq "no git identity: exit 1" "1" "$RC"
assert_ok "and the fix is shown" contains "$OUT" "MISSING a git identity: git config --global user.name"
rm -rf "$TMP/w"; mkdir "$TMP/w"; PRIVATE_UNREACHABLE=1 build "$TMP/w"; W="$TMP/w"
run "$W"
assert_eq "a private repo that cannot be cloned: exit 1" "1" "$RC"
assert_ok "and who to ask" contains "$OUT" "ask the owner for access"
rm -rf "$TMP/w"; mkdir "$TMP/w"; PRIVATE_EXISTS=1 build "$TMP/w"; W="$TMP/w"
run "$W"
assert_eq "an existing private clone is reused (no new clone)" "0" "$RC"
assert_ok "it is not cloned again" test -z "$(echo "$OUT" | grep 'cloned the private pack')"
assert_ok "and is checked out at the ref" contains "$OUT" "pack at vidi-v1"
echo '{"name": "vidi", "pack_ref": "no-such-ref"}' > "$W/pub/benchmarks/vidi/bench.json"
run "$W"
assert_eq "a pack ref that does not exist: exit 1" "1" "$RC"
assert_ok "and the tags are suggested" contains "$OUT" "MISSING pack ref no-such-ref (git -C"

echo "the held-out suite"
fresh
WITH_SUITE=1 rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
run "$W"
assert_eq "dependencies and browsers installed: exit 0" "0" "$RC"
assert_ok "npm ci ran" contains "$OUT" "installed in"
assert_ok "the agents' browser is checked" contains "$OUT" "agents' browser:"
rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
FAKE_NPM_RC=1 run "$W"
assert_eq "npm ci failing: exit 1" "1" "$RC"
assert_ok "and names where" contains "$OUT" "MISSING npm ci in"
rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
FAKE_BROWSER_FAIL=1 FAKE_UNAME=Darwin run "$W"
assert_eq "a browser that will not launch: exit 1" "1" "$RC"
assert_ok "the failure is reported" contains "$OUT" "MISSING agents' browser: browser ok"
rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
mkdir -p "$W/home/.cache/ms-playwright/chromium-1/chrome-linux64"; printf '#!/bin/sh\n' > "$W/home/.cache/ms-playwright/chromium-1/chrome-linux64/chrome"
chmod +x "$W/home/.cache/ms-playwright/chromium-1/chrome-linux64/chrome"
mk ldd 'echo "	libatk-1.0.so.0 => not found"; echo "	libc.so.6 => /lib/libc.so.6"'
FAKE_BROWSER_FAIL=1 FAKE_UNAME=Linux run "$W"
assert_ok "on Linux the missing shared libraries are named" contains "$OUT" "Chromium needs these libraries: libatk-1.0.so.0"
p="$(command -v ldd 2>/dev/null)"; [[ -n "$p" ]] && ln -sf "$p" "$BIN/ldd" || rm -f "$BIN/ldd"
rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
printf 'ID=ubuntu\nVERSION_ID="26.04"\n' > "$TMP/os-release"
OS_RELEASE_FILE="$TMP/os-release" FAKE_UNAME=Linux run "$W"
assert_ok "on an Ubuntu newer than Playwright knows, the 24.04 build is used and the note says so" contains "$OUT" "using Playwright's ubuntu24.04-x64 Chromium on this Ubuntu"
rm -rf "$TMP/w"; mkdir "$TMP/w"; WITH_SUITE=1 build "$TMP/w"; W="$TMP/w"
rm "$BIN/git"; run "$W"; ln -sf "$(command -v git)" "$BIN/git"
assert_ok "with problems already found the suite is not installed at all" test -z "$(echo "$OUT" | grep 'held-out suite')"

echo "a stack"
fresh
mkdir -p "$W/pub/benchmarks/reference/vidi/pistack"; echo 'CLIENT="pi"' > "$W/pub/benchmarks/reference/vidi/pistack/stack.env"
run "$W" --stack benchmarks/reference/vidi/pistack/
assert_eq "a stack whose client is installed: exit 0" "0" "$RC"
assert_ok "the stack is registered" contains "$OUT" "stack benchmarks/reference/vidi/pistack registered"
assert_ok "its client is checked" contains "$OUT" "ok    pi"
mkdir -p "$W/pub/benchmarks/reference/vidi/claudestack"; echo 'CLIENT="claude"' > "$W/pub/benchmarks/reference/vidi/claudestack/stack.env"
run "$W" --stack benchmarks/reference/vidi/claudestack
assert_eq "a Claude stack with no token: exit 1" "1" "$RC"
assert_ok "the way to make one is shown" contains "$OUT" "claude setup-token"
mkdir -p "$W/home/.dbench"; echo tok > "$W/home/.dbench/claude-oauth-token"; chmod 644 "$W/home/.dbench/claude-oauth-token"
run "$W" --stack benchmarks/reference/vidi/claudestack
assert_ok "a token that others can read is a problem" contains "$OUT" "should be chmod 600 (is 644)"
chmod 600 "$W/home/.dbench/claude-oauth-token"
ANTHROPIC_API_KEY=sk-x run "$W" --stack benchmarks/reference/vidi/claudestack
assert_eq "a 600 token: exit 0" "0" "$RC"
assert_ok "and a key in the shell is noted" contains "$OUT" "ANTHROPIC_API_KEY is set in your shell"
echo tok2 > "$TMP/elsewhere"; chmod 600 "$TMP/elsewhere"
CLAUDE_BENCH_TOKEN_FILE="$TMP/elsewhere" run "$W" --stack benchmarks/reference/vidi/claudestack
assert_ok "the token file can be moved with CLAUDE_BENCH_TOKEN_FILE" contains "$OUT" "token $TMP/elsewhere (600)"

echo "the preflight"
fresh
FAKE_PREFLIGHT_RC=1 run "$W"
assert_eq "a failing preflight: exit 1" "1" "$RC"
assert_ok "and says so" contains "$OUT" "preflight failed"

echo "the prompt to install"
fresh
FAKE_UNAME=Darwin FAKE_NODE=18.0.0 run_tty "$W" "n"
assert_ok "asked on a terminal, the offer names the command" contains "$OUT" "Run now: brew install node ? [y/N]"
assert_eq "answering no leaves node missing (exit 1)" "1" "$RC"
assert_ok "and does not run it" test ! -s "$W/log" -o -z "$(grep brew "$W/log" 2>/dev/null)"
fresh
mk node 'if [ -f "$FAKE_NODE_UPGRADED" ]; then echo v22.1.0; else echo "v${FAKE_NODE:-22.1.0}"; fi'
FAKE_UNAME=Darwin FAKE_NODE=18.0.0 run_tty "$W" "y"
assert_ok "answering yes runs the offered command" contains "$(cat "$W/log" 2>/dev/null)" "brew install node"
assert_eq "and when node is then new enough the machine is ready" "0" "$RC"
mk node 'echo "v${FAKE_NODE:-22.1.0}"'

finish
