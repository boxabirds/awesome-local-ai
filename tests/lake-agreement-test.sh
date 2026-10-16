#!/usr/bin/env bash
# The two readers of the lake print the same bytes (story 21).
#
# tools/bench-lake (Rust, the command bench-lake) and benchmarks/spec-bench/harness/lake_runs.py (Python) read the lake
# the same way and answer the same questions in the one canonical form of tools/bench-lake/CANONICAL.md. A later
# consumer picks either, so a difference between them is a defect in one of them. This runs both as the processes a
# consumer would start, over the fixture lake (trimmed copies of real runs), and compares standard output byte for byte
# and the exit code:
#   - every question of tools/bench-lake/golden/answers.json (every question over every fixture run: the six records,
#     the story records, rescore records, logs, working copies, completeness, copies, preferred), against each other and
#     against the golden bytes that were taken from the Rust command;
#   - the questions that fail, which the golden file does not hold: a malformed question is exit 2 with nothing on standard
#     output and one line on standard error, an absent record is exit 0, a comparison that could not look is exit 3.
# It needs cargo (to build the Rust command); without it the test says so and passes nothing it did not check.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

CRATE="$REPO_ROOT/tools/bench-lake"
FIXTURE="$CRATE/tests/fixtures/lake"
GOLDEN="$CRATE/golden/answers.json"
LAKE_PY="$REPO_ROOT/benchmarks/spec-bench/harness/lake_runs.py"
ID_FRESH="combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1"
ID_DRY="combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2"

if ! command -v cargo >/dev/null 2>&1; then
  echo "  skip  cargo is not installed: the Rust command cannot be built, so the two readers were not compared"
  exit 0
fi
if command -v uv >/dev/null 2>&1; then PY=(uv run --quiet python); else PY=(python3); fi

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

echo "build the Rust command"
if ! (cd "$REPO_ROOT/tools" && cargo build -q -p bench-lake) 2>"$SCRATCH/build.err"; then
  _fail "cargo build -p bench-lake" "a binary" "$(cat "$SCRATCH/build.err")"
  finish
fi
TARGET="$(cd "$REPO_ROOT/tools" && cargo metadata --no-deps --format-version 1 | "${PY[@]}" -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
BIN="$TARGET/debug/bench-lake"
assert_ok "the binary exists" test -x "$BIN"
assert_ok "the golden answers exist" test -s "$GOLDEN"
assert_ok "the fixture lake exists" test -d "$FIXTURE/collected"

echo
echo "every question of the golden file, through both commands"
# One process pair per question, so that what is compared is what a consumer would run. The driver prints one line per
# disagreement and a last line with the counts.
cat > "$SCRATCH/driver.py" <<'PYTHON'
import json, os, subprocess, sys
golden, lake, binary, module, scratch = sys.argv[1:6]
DEST, NONEMPTY = "<DEST>", "<NONEMPTY-DEST>"
asked = rust_vs_python = rust_vs_golden = python_vs_golden = exits = 0
problems = []
for i, entry in enumerate(json.load(open(golden))["questions"]):
    outputs = {}
    for who, command in (("rust", [binary]), ("python", [sys.executable, module])):
        dest = os.path.join(scratch, f"{who}-dest-{i}")
        nonempty = os.path.join(scratch, f"{who}-nonempty-{i}")
        args = []
        for a in entry["args"]:
            if a == DEST:
                args.append(dest)
            elif a == NONEMPTY:
                os.makedirs(nonempty)
                open(os.path.join(nonempty, "keep"), "w").close()
                args.append(nonempty)
            else:
                args.append(a)
        done = subprocess.run(command + [lake] + args, capture_output=True)
        text = done.stdout.decode("utf-8").replace(dest, DEST).replace(nonempty, NONEMPTY)
        outputs[who] = (done.returncode, text, done.stderr)
    asked += 1
    r, p = outputs["rust"], outputs["python"]
    if r[:2] == p[:2]:
        rust_vs_python += 1
    else:
        problems.append(f"rust and python differ on {entry['args']}: exit {r[0]} vs {p[0]}")
    if r[:2] == (entry["exit"], entry["stdout"]):
        rust_vs_golden += 1
    else:
        problems.append(f"rust differs from the golden file on {entry['args']}")
    if p[:2] == (entry["exit"], entry["stdout"]):
        python_vs_golden += 1
    else:
        problems.append(f"python differs from the golden file on {entry['args']}")
    if r[2] != b"" or p[2] != b"":
        problems.append(f"something on standard error for {entry['args']}")
for line in problems[:20]:
    print(line)
print(f"counts {asked} {rust_vs_python} {rust_vs_golden} {python_vs_golden} {len(problems)}")
PYTHON
OUT="$("${PY[@]}" "$SCRATCH/driver.py" "$GOLDEN" "$FIXTURE" "$BIN" "$LAKE_PY" "$SCRATCH" 2>"$SCRATCH/driver.err")"
COUNTS="$(printf '%s\n' "$OUT" | grep '^counts ' | tail -1)"
read -r _ ASKED SAME RUST_OK PY_OK PROBLEMS <<<"$COUNTS"
if [[ "${ASKED:-0}" -gt 300 ]]; then _pass "the golden file holds ${ASKED} questions"; else _fail "the golden file holds many questions" "more than 300" "${ASKED:-none}: $(cat "$SCRATCH/driver.err")"; fi
assert_eq "the two commands print the same bytes and exit code for every question" "$ASKED" "${SAME:-0}"
assert_eq "the Rust command prints the golden bytes for every question" "$ASKED" "${RUST_OK:-0}"
assert_eq "the Python command prints the golden bytes for every question" "$ASKED" "${PY_OK:-0}"
assert_eq "no disagreement and nothing on standard error" "0" "${PROBLEMS:-x}"
printf '%s\n' "$OUT" | grep -v '^counts ' | sed 's/^/         /'

echo
echo "the questions that fail"
rust() { "$BIN" "$FIXTURE" "$@"; }
python_cmd() { "${PY[@]}" "$LAKE_PY" "$FIXTURE" "$@"; }
for q in "frobnicate" "runs extra" "copies" "record $ID_FRESH" "record $ID_FRESH nonesuch" "record $ID_FRESH accept notanumber" \
         "log $ID_FRESH x1" "workspace $ID_FRESH 1" "complete"; do
  # shellcheck disable=SC2086
  rust $q >"$SCRATCH/r.out" 2>"$SCRATCH/r.err"; RC=$?
  # shellcheck disable=SC2086
  python_cmd $q >"$SCRATCH/p.out" 2>"$SCRATCH/p.err"; PC=$?
  assert_eq "malformed ($q): both exit 2" "2 2" "$RC $PC"
  assert_eq "malformed ($q): nothing on standard output" "0 0" "$(wc -c <"$SCRATCH/r.out" | tr -d ' ') $(wc -c <"$SCRATCH/p.out" | tr -d ' ')"
  assert_eq "malformed ($q): one line on standard error, starting bench-lake:" "1 1 yes yes" \
    "$(wc -l <"$SCRATCH/r.err" | tr -d ' ') $(wc -l <"$SCRATCH/p.err" | tr -d ' ') $(grep -q '^bench-lake: ' "$SCRATCH/r.err" && echo yes || echo no) $(grep -q '^bench-lake: ' "$SCRATCH/p.err" && echo yes || echo no)"
done
rust record "$ID_DRY" metrics >"$SCRATCH/r.out" 2>"$SCRATCH/r.err"; RC=$?
python_cmd record "$ID_DRY" metrics >"$SCRATCH/p.out" 2>"$SCRATCH/p.err"; PC=$?
assert_eq "an absent record is an answer: both exit 0" "0 0" "$RC $PC"
assert_ok "an absent record: the same bytes" cmp -s "$SCRATCH/r.out" "$SCRATCH/p.out"
assert_ok "an absent record: it says so" grep -q '"status":"absent"' "$SCRATCH/p.out"

mkdir "$SCRATCH/occupied"; : > "$SCRATCH/occupied/keep"
ID_Q36="combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2"
rust workspace "$ID_Q36" 1 "$SCRATCH/occupied" >"$SCRATCH/r.out" 2>/dev/null; RC=$?
python_cmd workspace "$ID_Q36" 1 "$SCRATCH/occupied" >"$SCRATCH/p.out" 2>/dev/null; PC=$?
assert_eq "a working copy into a folder that is not empty is refused: both exit 2" "2 2" "$RC $PC"
assert_ok "a refusal is printed on standard output, the same bytes" cmp -s "$SCRATCH/r.out" "$SCRATCH/p.out"
assert_ok "and says refused" grep -q '"status":"refused"' "$SCRATCH/p.out"

"$BIN" --roots "$FIXTURE/collected" "$FIXTURE/reference" runs >"$SCRATCH/r.out" 2>&1; RC=$?
"${PY[@]}" "$LAKE_PY" --roots "$FIXTURE/collected" "$FIXTURE/reference" runs >"$SCRATCH/p.out" 2>&1; PC=$?
"$BIN" "$FIXTURE" runs >"$SCRATCH/s.out" 2>&1
assert_eq "the two-root form: both exit 0" "0 0" "$RC $PC"
assert_ok "the two-root form: the same bytes in both commands" cmp -s "$SCRATCH/r.out" "$SCRATCH/p.out"
assert_ok "the two-root form equals the state-folder form" cmp -s "$SCRATCH/r.out" "$SCRATCH/s.out"

"$BIN" "$SCRATCH/no-lake-here" runs >"$SCRATCH/r.out" 2>&1; RC=$?
"${PY[@]}" "$LAKE_PY" "$SCRATCH/no-lake-here" runs >"$SCRATCH/p.out" 2>&1; PC=$?
assert_eq "a lake that is not there is an answer with the missing roots named: both exit 0" "0 0" "$RC $PC"
assert_ok "a missing lake: the same bytes" cmp -s "$SCRATCH/r.out" "$SCRATCH/p.out"
assert_ok "a missing lake: both roots named" grep -q '"missing_roots":\["collected","reference"\]' "$SCRATCH/p.out"

"$BIN" "$FIXTURE" compare-git "$SCRATCH/no-repo" >"$SCRATCH/r.out" 2>"$SCRATCH/r.err"; RC=$?
"${PY[@]}" "$LAKE_PY" "$FIXTURE" compare-git "$SCRATCH/no-repo" >"$SCRATCH/p.out" 2>"$SCRATCH/p.err"; PC=$?
assert_eq "a comparison with git that could not look is exit 3, never a pass" "3 3" "$RC $PC"
assert_eq "and prints nothing on standard output" "0 0" "$(wc -c <"$SCRATCH/r.out" | tr -d ' ') $(wc -c <"$SCRATCH/p.out" | tr -d ' ')"
assert_ok "and says why, in the same words" cmp -s "$SCRATCH/r.err" "$SCRATCH/p.err"

finish
