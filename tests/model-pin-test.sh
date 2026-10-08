#!/usr/bin/env bash
# A llama.cpp combination may pin its weights: MODEL_REVISION (the Hub commit) and MODEL_SHA256 ("<sha256>  <file>" lines).
#
# Added for the Underdog Saluki combination: two uploads a day old, so the file the series runs must be the exact bytes the
# card names, not whatever the repository holds on the day of the install. The installers run under `set -euo pipefail`, so the
# fetch is tested under it: on 8 Oct 2026 an unset MODEL_SHA256 aborted every llama.cpp install that declared no pin, and a test that
# did not set -u had passed. Combinations that declare neither behave exactly
# as before: no --revision is passed, no hash is checked, and nothing new is printed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$LOG_FILE"' EXIT

# A stand-in `hf`: records its arguments and writes the file the install asked for (content "weights").
mkdir -p "$WORK/bin"
cat > "$WORK/bin/hf" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$HF_CALLS"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --include) inc="$2"; shift 2 ;;
    --local-dir) dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$dir" && printf 'weights' > "$dir/$inc"
EOF
chmod +x "$WORK/bin/hf"

FILE_SHA="$(printf 'weights' | shasum -a 256 | cut -d' ' -f1)"

# Run the model fetch in a fresh shell with the combination's variables set; prints the hf calls, exit code on the last line.
fetch() { # <extra env assignments...>
  local dir="$WORK/models"; rm -rf "$dir"; : > "$WORK/calls"
  env HF_CALLS="$WORK/calls" PATH="$WORK/bin:$PATH" MODEL_DIR="$dir" MODEL_DISPLAY_NAME="Test model" \
      MODEL_ASSETS="owner/repo|m.gguf|model|1 B" LOG_FILE="$LOG_FILE" "$@" \
      bash -c "set -euo pipefail; . '$REPO_ROOT/lib/common.sh'; . '$REPO_ROOT/lib/hf.sh'; . '$REPO_ROOT/lib/model.sh'; _model_fetch_hf_files" > "$WORK/out" 2>&1
  echo $? > "$WORK/rc"
}

echo "without a pin it behaves as it always did"
fetch
assert_eq "it succeeds"                            "0" "$(cat "$WORK/rc")"
assert_eq "no --revision is passed"                "0" "$(grep -c -- '--revision' "$WORK/calls")"
assert_eq "nothing about hashes is printed"        "0" "$(grep -ci 'sha256\|hash' "$WORK/out")"

echo
echo "with a revision, the download is pinned to it"
fetch MODEL_REVISION=abc123
assert_eq "it succeeds"                            "0" "$(cat "$WORK/rc")"
assert_eq "hf is told the revision"                "1" "$(grep -c -- '--revision abc123' "$WORK/calls")"

echo
echo "with a checksum, the file is verified after download"
fetch MODEL_SHA256="$FILE_SHA  m.gguf"
assert_eq "a matching hash passes"                 "0" "$(cat "$WORK/rc")"
assert_eq "and says it was verified"               "1" "$(grep -c 'sha256 OK: m.gguf' "$WORK/out")"
fetch MODEL_SHA256="$(printf 'f%.0s' $(seq 1 64))  m.gguf"
assert_eq "a wrong hash refuses (non-zero exit)"   "1" "$(cat "$WORK/rc")"
assert_eq "and names the mismatch"                 "1" "$(grep -c 'sha256 mismatch for m.gguf' "$WORK/out")"

echo
echo "a file already on disk is still verified"
mkdir -p "$WORK/models"; printf 'weights' > "$WORK/models/m.gguf"
: > "$WORK/calls"
env HF_CALLS="$WORK/calls" PATH="$WORK/bin:$PATH" MODEL_DIR="$WORK/models" MODEL_DISPLAY_NAME="Test model" MODEL_ASSETS="owner/repo|m.gguf|model|1 B" \
    MODEL_SHA256="$(printf 'e%.0s' $(seq 1 64))  m.gguf" LOG_FILE="$LOG_FILE" \
    bash -c "set -euo pipefail; . '$REPO_ROOT/lib/common.sh'; . '$REPO_ROOT/lib/hf.sh'; . '$REPO_ROOT/lib/model.sh'; _model_fetch_hf_files" > "$WORK/out" 2>&1
assert_eq "a present file with the wrong hash refuses" "1" "$?"
assert_eq "without downloading again"              "0" "$(wc -l < "$WORK/calls" | tr -d ' ')"

finish
