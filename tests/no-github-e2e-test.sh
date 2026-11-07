#!/usr/bin/env bash
# tests/no-github-e2e-test.sh -- W-1 (story 23, TC-B1): a run made on a node with no git remote reaches the lake, the
# warehouse, the benchmarker and the gallery, and nothing is pushed anywhere.
#
#   1. The node: a bench checkout with no remote, and a git first on the PATH that refuses anything over the network
#      and logs every call. The harness's real story loop (test_pipeline's rig: a scripted agent, the held-out scoring)
#      records a two-story run in it with --record, then finalize and the finished event (test_no_publish_pipeline's
#      w1_node_run).
#   2. The real `dbench serve` over that checkout; one pass of the real collector (`dbench collect --once --scopes`):
#      the run's files into the lake, its code through the code route into the lake's code repository, the ingest
#      into a warehouse.
#   3. The benchmarker over the lake (Playwright): the run listed, its run page showing the score of record.
#   4. The gallery over the lake: opening the run checks out its last story, equal to the node's story-02.
# No GPU and no model; it needs node, npm, uv, cargo, bun and Playwright's chromium, and says what it skipped without.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$HERE/lib.sh"

for tool in node npm npx uv cargo bun curl; do
  command -v "$tool" >/dev/null || { echo "  skip: no $tool on this machine (W-1 needs it)"; finish; exit $?; }
done

TMP="$(mktemp -d)"
PIDS=()
# W1_KEEP=1 keeps the temporary folder (its logs) for a look after a failure.
cleanup() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null; done; [[ -n "${W1_KEEP:-}" ]] && echo "kept $TMP" || rm -rf "$TMP"; }
trap cleanup EXIT

COMB="kat/1/tiny/linux/box/fake-pi"
RUN="combinations/$COMB/benchmarks/vidi/w1"     # filed as vidi: the gallery lists vidi runs; the pack is the rig's kat
INSTALL="w1-install"
NODE="w1node"
SCORE="4/5"                                     # test_pipeline's known answer
CHECKOUT="$TMP/checkout"; STATE="$TMP/state"; HOST="$TMP/host"; SPY="$TMP/spy"; CALLS="$TMP/git-calls.log"
mkdir -p "$CHECKOUT" "$STATE" "$HOST/benchmarks/vidi" "$SPY"
git -C "$CHECKOUT" init -q
REAL_GIT="$(command -v git)"
cat > "$SPY/git" <<EOF
#!/bin/sh
printf '%s\t%s\0' "\$PWD" "\$*" >> '$CALLS'
for a in "\$@"; do case "\$a" in push|ls-remote|*://*|git@*) echo "no-github spy: refused network git: \$*" >&2; exit 97;; esac; done
exec '$REAL_GIT' "\$@"
EOF
chmod +x "$SPY/git"
export PATH="$SPY:$PATH"

echo "the builds"
(cd "$REPO/tools" && cargo build -q -p dbench -p bench-lake) || { echo "  FAIL cargo build of dbench and bench-lake"; exit 1; }
(cd "$REPO/tools" && cargo build -q -p vidi-gallery) || { echo "  FAIL cargo build of vidi-gallery"; exit 1; }
DBENCH="$REPO/tools/target/debug/dbench"; BENCH_LAKE="$REPO/tools/target/debug/bench-lake"
GALLERY="$REPO/tools/target/debug/vidi-gallery"

echo "the node records a run with no git remote"
(cd "$REPO/benchmarks/spec-bench/harness" && uv run --quiet --with pytest --with hypothesis python -c \
  "import sys, conftest, test_no_publish_pipeline as t; t.w1_node_run(*sys.argv[1:])" "$TMP" "$CHECKOUT" "$RUN" \
  > "$TMP/node-run.log" 2>&1)
assert_eq "the run is recorded" "0" "$?"
assert_ok "with its score of record" grep -q "\"score\": \"$SCORE\"" "$CHECKOUT/$RUN/finalize.json"
WS="$(cat "$CHECKOUT/$RUN/work_dir.txt")/workspace"
assert_eq "and a story tag per story in its own repository" "story-01 story-02" "$(git -C "$WS" tag | tr '\n' ' ' | sed 's/ $//')"
assert_eq "no workspace.bundle in the run folder" "" "$(find "$CHECKOUT/$RUN" -name '*.bundle')"
assert_eq "the checkout has no remote" "" "$(git -C "$CHECKOUT" remote)"

echo "the node serves it and the collector takes it"
printf 'INSTALL_ID="%s"\n' "$INSTALL" > "$CHECKOUT/combinations/$COMB/config.sh"
mkdir -p "$TMP/userhome/.local/share/$INSTALL"
printf 'INSTALL_ID="%s"\nCOMBINATION="%s"\n' "$INSTALL" "$COMB" > "$TMP/userhome/.local/share/$INSTALL/install.env"
HOME="$TMP/userhome" "$DBENCH" serve --bind 127.0.0.1:0 --no-pull --allow-unreleased --repo "$CHECKOUT" \
  --home "$TMP/dbench-home" --share-dir "$TMP/userhome/.local/share" > "$TMP/serve.out" 2> "$TMP/serve.err" &
PIDS+=($!)
for _ in $(seq 50); do grep -q "listening on" "$TMP/serve.out" 2>/dev/null && break; sleep 0.2; done
ADDR="$(sed -n 's/.*listening on //p' "$TMP/serve.out" | head -1)"
printf '[nodes.%s]\nurl = "http://%s"\ntoken = "%s"\n' "$NODE" "$ADDR" "$(cat "$TMP/dbench-home/token")" > "$TMP/nodes.toml"
"$DBENCH" collect --once --scopes --config "$TMP/nodes.toml" --store "$STATE/collected" \
  --db "$STATE/insights/conversations.db" --repo "$HOST" --free-space-margin-gib 0 > "$TMP/collect.log" 2>&1
assert_eq "one collector pass" "0" "$?"
LAKE_RUN="$STATE/collected/$NODE/$RUN"
assert_ok "the run's records are in the lake" cmp "$CHECKOUT/$RUN/finalize.json" "$LAKE_RUN/finalize.json"
for s in 01 02; do
  assert_eq "story $s's code is in the lake's code repository at the node's commit" \
    "$(git -C "$WS" rev-parse "story-$s")" \
    "$(git --git-dir "$STATE/code.git" rev-parse "refs/runs/$NODE/$RUN/story/$s" 2>/dev/null)"
done
assert_eq "no bundle in the lake" "" "$(find "$STATE" -name '*.bundle' -not -path '*/code.git/*')"
STORIES="$(uv run --quiet python -c "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute('select count(*) from stories where rel like ?', (sys.argv[2] + '%',)).fetchone()[0])" "$STATE/insights/conversations.db" "$RUN")"
assert_eq "both stories are in the warehouse" "2" "$STORIES"

echo "the benchmarker shows it"
echo '{"name": "vidi", "pack_ref": "kat-v1"}' > "$HOST/benchmarks/vidi/bench.json"
# A port the system has free now: a fixed one can be held by a benchmarker already running on this machine.
BM_PORT="$(uv run --quiet python -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
(cd "$REPO/tools/benchmarker" && bun server/main.ts --repo "$HOST" --lake "$STATE" --bench-lake "$BENCH_LAKE" \
  --port "$BM_PORT" --conversations-url http://127.0.0.1:1 > "$TMP/bm.out" 2> "$TMP/bm.err") &
PIDS+=($!)
# The server's first read of the lake can take a while on a busy machine (the release runs this after its builds).
for _ in $(seq 300); do curl -sf "http://127.0.0.1:$BM_PORT/api/state" 2>/dev/null | grep -q '"runId":"w1"' && break; sleep 0.2; done
assert_ok "the benchmarker has read the run from the lake" sh -c "curl -sf http://127.0.0.1:$BM_PORT/api/state | grep -q '\"runId\":\"w1\"'"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-}"
[[ -z "$BROWSERS" && -d "$HOME/.cache/hardened-harness/ms-playwright" ]] && BROWSERS="$HOME/.cache/hardened-harness/ms-playwright"
(cd "$REPO/tools/benchmarker" && PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" W1_BASE="http://127.0.0.1:$BM_PORT" W1_PACK=vidi W1_STACK="$COMB" \
  W1_RUN=w1 W1_SCORE="$SCORE" npx playwright test --config no-github.playwright.config.ts > "$TMP/playwright.log" 2>&1)
PW_RC=$?
assert_eq "the run is listed and its page shows the score of record (Playwright)" "0" "$PW_RC"
(( PW_RC == 0 )) || { echo "  --- Playwright's output:"; tail -40 "$TMP/playwright.log" | sed 's/^/  | /'; }

echo "the gallery opens story 2 from the lake"
mkdir -p "$TMP/galleryhome"
HOME="$TMP/galleryhome" "$GALLERY" --repo "$HOST" --lake "$STATE" --port 0 > "$TMP/gallery.out" 2> "$TMP/gallery.err" &
PIDS+=($!)
for _ in $(seq 100); do grep -q "^vidi-gallery: http://127.0.0.1:" "$TMP/gallery.out" 2>/dev/null && break; sleep 0.2; done
G_PORT="$(sed -n 's|^vidi-gallery: http://127.0.0.1:\([0-9]*\).*|\1|p' "$TMP/gallery.out" | head -1)"
SLUG="$(curl -sf "http://127.0.0.1:$G_PORT/api/runs" | uv run --quiet python -c "import json, sys; print(next(r['slug'] for r in json.load(sys.stdin)['runs'] if r['run'] == 'w1'))")"
assert_ok "the gallery lists the run" test -n "$SLUG"
assert_eq "opening it answers 200" "200" "$(curl -s -o "$TMP/open.json" -w '%{http_code}' -X POST "http://127.0.0.1:$G_PORT/api/open/$SLUG")"
CO="$TMP/galleryhome/.cache/awesome-local-ai/vidi-gallery/checkouts/$SLUG@02"
assert_eq "its checkout is story 2's commit on the node" "$(git -C "$WS" rev-parse story-02)" "$(git -C "$CO" rev-parse HEAD 2>/dev/null)"
assert_eq "with the files of that commit, unchanged" "" "$(git -C "$CO" status --porcelain 2>&1)"
curl -s -X POST "http://127.0.0.1:$G_PORT/api/stop/$SLUG" >/dev/null

echo "nothing was pushed"
assert_eq "no git push, and no git command over the network" "0" \
  "$(tr '\0' '\n' < "$CALLS" | grep -cE $'\t(.* )?(push|ls-remote)( |$)|://|git@')"
assert_eq "the node checkout has no commit but its own: nothing was committed there" "0" \
  "$(git -C "$CHECKOUT" rev-list --all 2>/dev/null | wc -l | tr -d ' ')"

finish
