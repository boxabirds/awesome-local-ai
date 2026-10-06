#!/usr/bin/env bash
# gufo backend: the weight check (exact sizes, so existing files are adopted),
# the combination's invariants, the manifest round-trip, and the exact podman/
# gufo argv the launcher builds -- all without Podman or a GPU. `podman` is a
# stub on PATH that records what it was asked to do, so these assert the
# command line itself, not a paraphrase of it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
INSTALL_ROOT="$(mktemp -d)"
. "$REPO_ROOT/lib/model.sh"
. "$REPO_ROOT/lib/gufo.sh"

COMBO=qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"
WORK="$(mktemp -d)"
FAKE_SERVERS=()
trap 'for p in "${FAKE_SERVERS[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$WORK" "$INSTALL_ROOT" "$LOG_FILE"' EXIT

echo "weights: every file at its exact size"
W="$WORK/weights"; mkdir -p "$W/sub"
GUFO_MODEL_FILES="
sub/model.gguf|5
mtp.gguf|3
"
assert_eq "nothing there -> missing" "missing sub/model.gguf (no file, of 5 bytes)" "$(_gufo_weights_state "$W")"
printf 'abcde' > "$W/sub/model.gguf"; printf 'xyz' > "$W/mtp.gguf"
assert_eq "both at their sizes -> valid (adopted, no download)" "valid" "$(_gufo_weights_state "$W")"
printf 'ab' > "$W/sub/model.gguf"
assert_eq "a short file -> missing, naming it" "missing sub/model.gguf (2 of 5 bytes)" "$(_gufo_weights_state "$W")"

echo
echo "smoke test: what gufo actually answers (fields as seen on the Strix Halo box, 27 Sep 2026)"
RESP='{"usage":{"completion_tokens":120,"draft_tokens":133,"draft_tokens_accepted":104,"gufo":{"prefill_tokens":25}}}'
assert_eq "draft counters read from usage" "104 133" "$(_gufo_draft_counts <<< "$RESP")"
assert_eq "no counters -> nothing" "" "$(_gufo_draft_counts <<< '{"usage":{"completion_tokens":5}}')"
echo
echo "smoke test: the served context comes from gufo's own load line (its API doesn't report it)"
# gufo b722a61's /v1/models lists only the model name, and /props?model= returns an empty
# model_info; the load line in the container log is the one place it states the context.
curl() { echo '{"object":"list","data":[{"id":"qwen3.8-flash-next-gufo","object":"model","owned_by":"gufo"}]}'; }
podman() {
  [[ "$1 $2" == "logs qwen38-flash-next-strix-gufo-18010" ]] || return 1
  echo '2026-09-27 19:10:06 [INFO] [loader] event=load_completed kind=text elapsed_ms=34236 model=qwen3.8-flash-next-gufo sessions=1 context_tokens=131072 speculative=mtp draft_limit=7'
}
assert_eq "context read from the load line" "131072" "$(INSTALL_ID=qwen38-flash-next-strix-gufo backend_smoke_context 18010)"
podman() { return 1; }
assert_eq "no container log -> unknown" "?" "$(INSTALL_ID=qwen38-flash-next-strix-gufo backend_smoke_context 18010)"
unset -f curl podman

smoke_extra() { # the SMOKE_REQUEST_EXTRA the installer would send, with the combination loaded
  bash -c 'LOG_FILE=/dev/null; . "$1/lib/common.sh"; . "$2"; . "$1/lib/gufo.sh"; printf "%s" "$SMOKE_REQUEST_EXTRA"' _ "$REPO_ROOT" "$CFG"
}
assert_ok "the generic smoke request names the model (gufo answers 400 missing_model otherwise)" \
  grep -qF '"model":"qwen3.8-flash-next-gufo"' <<< "$(smoke_extra)"

echo
echo "image version check: the pin must match what the image's binary prints"
# Formats seen: a development build prints "gufo version <hash>"; a release prints
# "gufo version <release> (<hash>)" (0.5.0, read on the Strix Halo box, 2 Oct 2026).
# podman is called as `podman run ...`: the stub ignores its arguments and prints $LINE
version_check() {
  local line="$1" pin="$2"
  # err() exits, so the check runs in its own subshell and its exit status decides
  local read
  read="$( podman() { printf '%s\n' "$line"; }; GUFO_IMAGE=img GUFO_VERSION="$pin"
           _gufo_require_version >/dev/null 2>&1 && echo "$GUFO_IMAGE_VERSION" )" || read=FAIL
  echo "$read"
}
assert_eq "release line: the release number is the version"  "0.5.0"   "$(version_check 'gufo version 0.5.0 (23cacbb)' 0.5.0)"
assert_eq "release line: a pin of the bare hash does not match" "FAIL"  "$(version_check 'gufo version 0.5.0 (23cacbb)' 23cacbb)"
assert_eq "release line: a pin with the parentheses does not match" "FAIL" "$(version_check 'gufo version 0.5.0 (23cacbb)' '(23cacbb)')"
assert_eq "release line: a different release is refused"     "FAIL"    "$(version_check 'gufo version 0.5.0 (23cacbb)' 0.4.0)"
assert_eq "development line: the hash is still the version"  "b722a61" "$(version_check 'gufo version b722a61' b722a61)"
assert_eq "development line: a different hash is refused"    "FAIL"    "$(version_check 'gufo version b722a61' 23cacbb)"

echo
echo "combination config"
assert_ok "image pinned by digest"          grep -qE '^GUFO_IMAGE="[^"]+@sha256:[0-9a-f]{64}"' "$CFG"
assert_ok "engine version named (a release number or a commit hash)" \
  grep -qE '^GUFO_VERSION="([0-9]+\.[0-9]+\.[0-9]+|[0-9a-f]{7,})"' "$CFG"
assert_ok "revision is a full commit"       grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$CFG"
assert_ok "opts out of automatic selection" grep -qE '^AUTO_SELECT=0$' "$CFG"
assert_ok "no host GPU runtime is built"    grep -qE '^GPU_API="none"' "$CFG"
assert_ok "profiles.tsv declares the gufo schema on line 1" \
  bash -c "head -1 '$REPO_ROOT/combinations/$COMBO/profiles.tsv' | grep -qx '# $PROFILE_SCHEMA'"
assert_ok "every profile row has 8 columns" bash -c \
  "awk -F'|' '!/^[[:space:]]*(#|\$)/ && NF!=8 {bad=1} END{exit bad}' '$REPO_ROOT/combinations/$COMBO/profiles.tsv'"
assert_ok "every profile row says where its numbers came from" bash -c \
  "awk -F'|' '!/^[[:space:]]*(#|\$)/ && \$7 !~ /^(MEASURED-|EXTRAPOLATED\$)/ {bad=1} END{exit bad}' '$REPO_ROOT/combinations/$COMBO/profiles.tsv'"
assert_ok "the model and MTP head are among the listed files" bash -c "
  . '$CFG'; grep -qF \"\$GUFO_MODEL_REL|\" <<< \"\$GUFO_MODEL_FILES\" && grep -qF \"\$GUFO_MTP_REL|\" <<< \"\$GUFO_MODEL_FILES\""

# ---- the launcher, end to end against a podman stub -----------------------
# A fake install whose manifest is written by the real backend_manifest_extra,
# so the %q round-trip is exercised, then lib/runtime/server-gufo.sh.
FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME/.local/share/x" "$FAKE_HOME/bin"
(
  set -e
  . "$CFG"
  . "$REPO_ROOT/lib/gufo.sh"
  MODEL_SUBDIR="gufo/models"
  mkdir -p "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR/$(dirname "$GUFO_MODEL_REL")" \
           "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR/$(dirname "$GUFO_MTP_REL")"
  : > "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR/$GUFO_MODEL_REL"
  : > "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR/$GUFO_MTP_REL"
  {
    printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=gufo\nACCEL=strix-halo\n' "$INSTALL_ID" "$DISPLAY_NAME"
    printf 'MODEL_SUBDIR=%q\nMODEL_FILE=%q\nMODEL_ALIAS_DEFAULT=%q\n' "$MODEL_SUBDIR" "$MODEL_WEIGHTS_DIR" "$MODEL_ALIAS_DEFAULT"
    printf 'MODEL_CACHE_ENV_VAR=GUFO_MODEL_CACHE\nDEFAULT_PROFILE=%q\nSAMPLING_THINKING=%q\n' "$DEFAULT_PROFILE" "$SAMPLING_THINKING"
    printf 'REASONING_EFFORT_DEFAULT=%q\nREASONING_EFFORTS=%q\nSERVER_CMD=test-server\n' \
      "$REASONING_EFFORT_DEFAULT" "$REASONING_EFFORTS"
    backend_manifest_extra
  } > "$FAKE_HOME/.local/share/x/install.env"
  cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$FAKE_HOME/.local/share/x/"
)
cat > "$FAKE_HOME/bin/podman" <<'STUB'
#!/usr/bin/env bash
# records every call; `run` prints its argv one per line then (optionally) idles
echo "CALL $*" >> "$PODMAN_LOG"
case "$1" in
  inspect) exit 1 ;;
  stop)    kill "$(cat "$PODMAN_LOG.pid" 2>/dev/null)" 2>/dev/null; exit 0 ;;
  run)     shift; printf '%s\n' "$@" > "$PODMAN_ARGV"
           if [[ "${PODMAN_IDLE:-0}" == "1" ]]; then echo $$ > "$PODMAN_LOG.pid"; exec sleep 30; fi
           exit 0 ;;
esac
STUB
chmod +x "$FAKE_HOME/bin/podman"
# `ps` is stubbed so the guard against a second model server sees only what a test asks it to: a developer
# machine may be running ollama or LM Studio, and that must not decide whether these assertions pass.
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$FAKE_HOME/bin/ps"
chmod +x "$FAKE_HOME/bin/ps"

ARGV="$WORK/argv"
launch() { # env... -- runs the launcher under the fake home; argv lands in $ARGV
  env -i PATH="$FAKE_HOME/bin:/usr/bin:/bin" HOME="$FAKE_HOME" LOCAL_AI_INSTALL_REL=.local/share/x \
      PODMAN_LOG="$WORK/podman.log" PODMAN_ARGV="$ARGV" PORT=39997 "$@" \
      bash "$REPO_ROOT/lib/runtime/server-gufo.sh" >"$WORK/launch.out" 2>&1
}
has_arg()  { grep -qxF -- "$1" "$ARGV"; }
has_pair() { awk -v a="$1" -v b="$2" 'p==a && $0==b {f=1} {p=$0} END{exit !f}' "$ARGV"; }

echo
echo "launcher: default profile"
rm -f "$ARGV"; launch
. "$CFG"
assert_ok "runs the pinned image"                    has_arg "$GUFO_IMAGE"
assert_ok "port published on loopback only"         has_pair -p 127.0.0.1:39997:8080
assert_ok "weights mounted read-only at /models"     has_pair -v "$FAKE_HOME/gufo/models/qwen3.8-flash-next:/models:ro"
assert_ok "the GPU's compute node passed in"         has_pair --device /dev/kfd
assert_ok "...and the render nodes"                  has_pair --device /dev/dri
assert_ok "...with the caller's render/video groups" has_pair --group-add keep-groups
assert_ok "the model, inside the container"          has_pair --model "/models/$GUFO_MODEL_REL"
assert_ok "the MTP head"                             has_pair --mtp-model "/models/$GUFO_MTP_REL"
assert_ok "MTP speculation on"                       has_pair --speculative mtp
assert_ok "128k context"                             has_pair --context 131072
assert_ok "one session"                              has_pair --sessions 1
assert_ok "gufo's draft depth, 7"                    has_pair --draft-tokens 7
assert_ok "the stable model id (gufo 404s on others)" has_pair --served-model-name qwen3.8-flash-next-gufo
assert_ok "thinking on"                              has_pair --think on
assert_ok "the thinking sampler, as llamacpp-pi"     has_pair --temperature 1.0
assert_ok "...top-k 20"                              has_pair --top-k 20
assert_ok "effort defaults to low"                   has_pair --reasoning-effort low
assert_ok "named container, removed on exit"         has_pair --name qwen38-flash-next-strix-gufo-39997

rm -f "$ARGV"; launch REASONING_EFFORT=default
assert_ok    "REASONING_EFFORT=default still launches" test -f "$ARGV"
assert_fails "...and passes no effort flag"            grep -qx -- --reasoning-effort "$ARGV"

rm -f "$ARGV"; launch THINKING=0
assert_ok    "THINKING=0: thinking off"                has_pair --think off
assert_ok    "...with the instruct sampler"            has_pair --temperature 0.7
assert_fails "...and no effort flag"                   grep -qx -- --reasoning-effort "$ARGV"

rm -f "$ARGV"; launch DRAFT_TOKENS=4 CTX=65536
assert_ok "DRAFT_TOKENS overrides the profile"         has_pair --draft-tokens 4
assert_ok "CTX overrides the profile"                  has_pair --context 65536

rm -f "$ARGV"
assert_fails "an effort the template raises on is refused" launch REASONING_EFFORT=bogus
assert_fails "...before podman ran"                    test -f "$ARGV"
assert_fails "an unknown profile is refused"           launch PROFILE=nope

echo
echo "launcher: refuses beside another model server"
# The guard reads the process list, so the test writes one. It used to spawn a real process named
# llama-server, which suited the old pgrep -x check; the guard now matches command lines, so every engine
# is recognisable, and a stubbed list is both deterministic and able to pose as engines we cannot run here.
rm -f "$ARGV"
assert_fails "a running llama-server stops the launch" launch PS_OUT="  4242 /opt/llama.cpp/llama-server -m m.gguf --port 8010"
assert_fails "...before podman ran"                    test -f "$ARGV"
assert_ok    "...and says why"                         grep -q "another model server is running" "$WORK/launch.out"
# ...and the engines a narrower guard used to miss. gufo's old pattern knew three names; these four ran beside it.
for other in \
  "  51 /Users/x/.venv/bin/python /Users/x/Strata/serve/server.py --engine strata --config r.json" \
  "  52 /Users/x/.venv/bin/mlx-serve --serve --model q4" \
  "  53 /usr/local/bin/tensorfold serve --model q" \
  "  54 /Applications/Ollama.app/Contents/Resources/ollama serve" \
  ; do
  rm -f "$ARGV"
  assert_fails "...and this one too: ${other##*/}" launch PS_OUT="$other"
done
rm -f "$ARGV"; launch ALLOW_COEXIST=1
assert_ok    "ALLOW_COEXIST=1 overrides it"            test -f "$ARGV"
# The guard matches names, not command lines: a process whose arguments merely
# mention llama-server (here the launcher itself) must not count.
kill "${FAKE_SERVERS[@]}" 2>/dev/null; wait "${FAKE_SERVERS[@]}" 2>/dev/null; FAKE_SERVERS=()
rm -f "$ARGV"
env -i PATH="$FAKE_HOME/bin:/usr/bin:/bin" HOME="$FAKE_HOME" LOCAL_AI_INSTALL_REL=.local/share/x \
    PODMAN_LOG="$WORK/podman.log" PODMAN_ARGV="$ARGV" PORT=39997 \
    bash "$REPO_ROOT/lib/runtime/server-gufo.sh" --llama-server-in-argv >/dev/null 2>&1
assert_ok    "a command line that merely mentions llama-server is not a server" test -f "$ARGV"

echo
echo "launcher: refuses without weights"
mv "$FAKE_HOME/gufo/models/qwen3.8-flash-next" "$WORK/moved"
rm -f "$ARGV"
assert_fails "no weights -> refused"                   launch
assert_ok    "...naming the missing file"              grep -q "weights not found" "$WORK/launch.out"
mv "$WORK/moved" "$FAKE_HOME/gufo/models/qwen3.8-flash-next"

echo
echo "launcher: SIGTERM stops the container"
: > "$WORK/podman.log"
env -i PATH="$FAKE_HOME/bin:/usr/bin:/bin" HOME="$FAKE_HOME" LOCAL_AI_INSTALL_REL=.local/share/x \
    PODMAN_LOG="$WORK/podman.log" PODMAN_ARGV="$ARGV" PODMAN_IDLE=1 PORT=39996 \
    bash "$REPO_ROOT/lib/runtime/server-gufo.sh" >/dev/null 2>&1 &
lpid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q 'CALL run' "$WORK/podman.log" 2>/dev/null && break; sleep 0.3; done
kill -TERM "$lpid" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$lpid" 2>/dev/null || break; sleep 0.3; done
assert_ok "podman stop was called for the named container" \
  grep -qE '^CALL stop -t [0-9]+ qwen38-flash-next-strix-gufo-39996$' "$WORK/podman.log"
assert_fails "the launcher exited" kill -0 "$lpid"
kill "$(cat "$WORK/podman.log.pid" 2>/dev/null)" 2>/dev/null || true

finish
