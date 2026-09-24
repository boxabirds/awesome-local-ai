#!/usr/bin/env bash
# SGLang backend: weight-cache idempotency, hash verification, the manifest
# round-trip, and the exact docker/SGLang argv the launcher builds -- all
# without Docker or a GPU. `docker` is a stub on PATH that records what it was
# asked to do, so these assert the command line itself, not a paraphrase of it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
INSTALL_ROOT="$(mktemp -d)"
. "$REPO_ROOT/lib/model.sh"
. "$REPO_ROOT/lib/sglang.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$INSTALL_ROOT" "$LOG_FILE"' EXIT

echo "version comparison"
assert_ok    "13.0 >= 13.0"  _sglang_version_ge 13.0 13.0
assert_ok    "13.1 >= 13.0"  _sglang_version_ge 13.1 13.0
assert_fails "12.9 >= 13.0"  _sglang_version_ge 12.9 13.0
assert_ok    "13.10 >= 13.2" _sglang_version_ge 13.10 13.2

echo
echo "weights: shards, marker, revision"
W="$WORK/weights"; mkdir -p "$W"
cat > "$W/model.safetensors.index.json" <<'JSON'
{"weight_map": {"a": "model-00001-of-00002.safetensors", "b": "model-00002-of-00002.safetensors"}}
JSON
assert_fails "an index without shards is incomplete" _sglang_shards_present "$W"
echo one > "$W/model-00001-of-00002.safetensors"
echo two > "$W/model-00002-of-00002.safetensors"
assert_ok    "both shards present" _sglang_shards_present "$W"

MODEL_REPO="example/repo"; MODEL_REVISION="aaaa1111"
assert_eq "no marker -> absent" "absent" "$(_sglang_weights_state "$W")"
MODEL_SHA256="
$(shasum -a 256 "$W/model-00001-of-00002.safetensors" | cut -d' ' -f1)  model-00001-of-00002.safetensors
$(shasum -a 256 "$W/model-00002-of-00002.safetensors" | cut -d' ' -f1)  model-00002-of-00002.safetensors
"
assert_ok "matching hashes verify" _sglang_verify_hashes "$W"
_sglang_write_marker "$W"
assert_eq "verified marker at this revision -> valid (no re-download)" "valid" "$(_sglang_weights_state "$W")"
MODEL_REVISION="bbbb2222"
assert_eq "a different revision -> stale" "stale" "$(_sglang_weights_state "$W")"
MODEL_REVISION="aaaa1111"
echo truncated-and-changed > "$W/model-00002-of-00002.safetensors"
assert_eq "a shard whose size changed -> stale" "stale" "$(_sglang_weights_state "$W")"
assert_fails "a changed shard fails hash verification" bash -c "
  LOG_FILE='$LOG_FILE'; . '$REPO_ROOT/lib/common.sh'; . '$REPO_ROOT/lib/sglang.sh'
  MODEL_SHA256='$MODEL_SHA256'; _sglang_verify_hashes '$W'"

echo
echo "combination configs"
for c in qwen/3.8/27b/ubuntu/24GB/sglang-opencode qwen/3.6/35b-a3b/ubuntu/24GB/sglang-opencode; do
  cfg="$REPO_ROOT/combinations/$c/config.sh"
  assert_ok "$c: image pinned by digest" grep -qE '^SGLANG_IMAGE="[^"]+@sha256:[0-9a-f]{64}"' "$cfg"
  assert_ok "$c: revision is a full commit" grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$cfg"
  assert_ok "$c: opts out of automatic selection" grep -qE '^AUTO_SELECT=0$' "$cfg"
  assert_ok "$c: only sm_86 claimed" grep -qE '^ACCEL_ARCHS_VERIFIED="86"$' "$cfg"
  assert_ok "$c: profiles.tsv declares the sglang schema on line 1" \
    bash -c "head -1 '$REPO_ROOT/combinations/$c/profiles.tsv' | grep -qx '# $PROFILE_SCHEMA'"
  assert_ok "$c: every profile row has 7 columns" bash -c \
    "awk -F'|' '!/^[[:space:]]*(#|\$)/ && NF!=7 {bad=1} END{exit bad}' '$REPO_ROOT/combinations/$c/profiles.tsv'"
  assert_ok "$c: every non-recipe profile is labelled EXTRAPOLATED" bash -c \
    "awk -F'|' '!/^[[:space:]]*(#|\$)/ && \$6 !~ /^(RECIPE-|EXTRAPOLATED\$)/ {bad=1} END{exit bad}' '$REPO_ROOT/combinations/$c/profiles.tsv'"
done

# ---- the launcher, end to end against a docker stub -----------------------
# Builds a fake install (manifest via the real backend_manifest_extra, so the
# %q round-trip is exercised) and runs lib/runtime/server-sglang.sh.
make_install() { # combination -> sets FAKE_HOME
  local combo="$1"
  FAKE_HOME="$WORK/home-$(printf '%s' "$combo" | tr '/' '_')"
  mkdir -p "$FAKE_HOME/.local/share/x" "$FAKE_HOME/bin"
  (
    set -e
    . "$REPO_ROOT/combinations/$combo/config.sh"
    . "$REPO_ROOT/lib/sglang.sh"
    MODEL_SUBDIR="models"
    mkdir -p "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR"
    echo '{"weight_map":{}}' > "$FAKE_HOME/$MODEL_SUBDIR/$MODEL_WEIGHTS_DIR/model.safetensors.index.json"
    {
      printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=sglang\nACCEL=cuda\n' "$INSTALL_ID" "$DISPLAY_NAME"
      printf 'MODEL_SUBDIR=models\nMODEL_FILE=%q\nMODEL_ALIAS_DEFAULT=%q\n' "$MODEL_WEIGHTS_DIR" "$MODEL_ALIAS_DEFAULT"
      printf 'MODEL_CACHE_ENV_VAR=SGLANG_MODEL_CACHE\nDEFAULT_PROFILE=%q\nDEFAULT_PORT=%q\n' "$DEFAULT_PROFILE" "$DEFAULT_PORT"
      printf 'REASONING_EFFORT_DEFAULT=%q\nREASONING_EFFORTS=%q\nSERVER_CMD=test-server\n' \
        "$REASONING_EFFORT_DEFAULT" "$REASONING_EFFORTS"
      backend_manifest_extra
    } > "$FAKE_HOME/.local/share/x/install.env"
    cp "$REPO_ROOT/combinations/$combo/profiles.tsv" "$REPO_ROOT/combinations/$combo/help.txt" "$FAKE_HOME/.local/share/x/"
  )
  cat > "$FAKE_HOME/bin/docker" <<'STUB'
#!/usr/bin/env bash
# records every call; `run` prints its argv one per line then idles
echo "CALL $*" >> "$DOCKER_LOG"
case "$1" in
  inspect) exit 1 ;;
  stop)    kill "$(cat "$DOCKER_LOG.pid" 2>/dev/null)" 2>/dev/null; exit 0 ;;
  run)     shift; printf '%s\n' "$@" > "$DOCKER_ARGV"
           if [[ "${DOCKER_IDLE:-0}" == "1" ]]; then echo $$ > "$DOCKER_LOG.pid"; exec sleep 30; fi
           exit 0 ;;
esac
STUB
  chmod +x "$FAKE_HOME/bin/docker"
}

launch() { # env... -- runs the launcher under the fake home; argv lands in $ARGV
  env -i PATH="$FAKE_HOME/bin:/usr/bin:/bin" HOME="$FAKE_HOME" LOCAL_AI_INSTALL_REL=.local/share/x \
      DOCKER_LOG="$WORK/docker.log" DOCKER_ARGV="$ARGV" PORT=39999 "$@" \
      bash "$REPO_ROOT/lib/runtime/server-sglang.sh" >/dev/null 2>&1
}
has_arg()  { grep -qxF -- "$1" "$ARGV"; }
has_pair() { awk -v a="$1" -v b="$2" 'p==a && $0==b {f=1} {p=$0} END{exit !f}' "$ARGV"; }

ARGV="$WORK/argv"

echo
echo "launcher: Qwen3.8-27B"
make_install qwen/3.8/27b/ubuntu/24GB/sglang-opencode
rm -f "$ARGV"; launch
assert_ok "default profile runs the pinned image" \
  has_arg "ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8"
assert_ok "full: --context-length 262144"          has_pair --context-length 262144
assert_ok "full: --mem-fraction-static 0.88"       has_pair --mem-fraction-static 0.88
assert_ok "full: prefill graphs off"               has_arg --disable-prefill-cuda-graph
assert_ok "port published on loopback only"        has_pair -p 127.0.0.1:39999:30000
assert_ok "weights mounted read-only at the recipe path" \
  has_pair -v "$FAKE_HOME/models/turboderp-Qwen3.8-27B-exl3-3.00bpw:/models/turboderp-Qwen3.8-27B-exl3-3.00bpw:ro"
assert_ok "GPU 0 by default"                       has_pair --gpus device=0
assert_ok "recipe env: embedding in host memory"   has_pair -e SGLANG_EXL3_EMBED_HOST=1
assert_ok "recipe argv: exl3 quantization"         has_pair --quantization exl3
assert_ok "recipe argv: MTP token map"             has_pair --speculative-token-map /opt/sglang-exl3/tokenmaps/qwen38_hot32k_v2.pt
assert_ok "recipe served id"                       has_pair --served-model-name turboderp-Qwen3.8-27B-exl3-3.00bpw
assert_ok "server-side effort defaults to low"     has_pair --default-chat-template-kwargs '{"reasoning_effort": "low"}'

rm -f "$ARGV"; launch PROFILE=graphs
assert_ok    "graphs: --context-length 204800"     has_pair --context-length 204800
assert_ok    "graphs: --mem-fraction-static 0.80"  has_pair --mem-fraction-static 0.80
assert_fails "graphs: prefill graphs NOT disabled" has_arg --disable-prefill-cuda-graph

rm -f "$ARGV"; launch THINKING=0 GPU_DEVICE=1
assert_ok "THINKING=0 disables thinking server-side" has_pair --default-chat-template-kwargs '{"enable_thinking": false}'
assert_ok "GPU_DEVICE selects the card"              has_pair --gpus device=1

rm -f "$ARGV"; launch REASONING_EFFORT=default
assert_fails "REASONING_EFFORT=default adds nothing (the recipe's argv)" grep -q -- --default-chat-template-kwargs "$ARGV"

rm -f "$ARGV"
assert_fails "an effort the template raises on is refused before launch" launch REASONING_EFFORT=high
assert_fails "...and docker was never run" test -f "$ARGV"
assert_fails "an unknown profile is refused" launch PROFILE=nope

echo
echo "launcher: Qwen3.6-35B-A3B"
make_install qwen/3.6/35b-a3b/ubuntu/24GB/sglang-opencode
rm -f "$ARGV"; launch
assert_ok    "full: --context-length 262144"        has_pair --context-length 262144
assert_ok    "full: --mem-fraction-static 0.85"     has_pair --mem-fraction-static 0.85
assert_ok    "recipe argv: shared-experts fusion off" has_arg --disable-shared-experts-fusion
assert_fails "no embedding-on-host env for the 35B" has_pair -e SGLANG_EXL3_EMBED_HOST=1
assert_fails "no effort kwarg: the template has none" grep -q -- --default-chat-template-kwargs "$ARGV"
assert_fails "REASONING_EFFORT is refused for this model" launch REASONING_EFFORT=low

echo
echo "launcher: SIGTERM stops the container"
: > "$WORK/docker.log"
env -i PATH="$FAKE_HOME/bin:/usr/bin:/bin" HOME="$FAKE_HOME" LOCAL_AI_INSTALL_REL=.local/share/x \
    DOCKER_LOG="$WORK/docker.log" DOCKER_ARGV="$ARGV" DOCKER_IDLE=1 PORT=39998 \
    bash "$REPO_ROOT/lib/runtime/server-sglang.sh" >/dev/null 2>&1 &
lpid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q 'CALL run' "$WORK/docker.log" 2>/dev/null && break; sleep 0.3; done
kill -TERM "$lpid" 2>/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$lpid" 2>/dev/null || break; sleep 0.3; done
assert_ok "docker stop was called for the named container" \
  grep -qE '^CALL stop -t [0-9]+ qwen36-35b-a3b-exl3-sglang-39998$' "$WORK/docker.log"
assert_fails "the launcher exited" kill -0 "$lpid"
kill "$(cat "$WORK/docker.log.pid" 2>/dev/null)" 2>/dev/null || true

finish
