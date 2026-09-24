#!/usr/bin/env bash
# mlx-serve backend: binary resolution and the pinned-release install, weight
# fetch idempotency, and the exact mlx-serve argv the launcher builds -- all
# without mlx-serve, a model or the network. `mlx-serve`, `hf`, `ps`, `curl`,
# `memory_pressure` and `sysctl` are stubs on PATH that record what they were
# asked to do, so these assert the command line itself, not a paraphrase.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
INSTALL_ROOT="$(mktemp -d)"
. "$REPO_ROOT/lib/model.sh"
. "$REPO_ROOT/lib/mlxserve.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$INSTALL_ROOT" "$LOG_FILE"' EXIT
COMBO="qwen/3.8/flash-next/macos/128GB/mlxserve-opencode"
CFG="$REPO_ROOT/combinations/$COMBO/config.sh"

echo "version comparison (mlx-serve is calendar-versioned)"
assert_ok    "26.9.5 >= 26.9.5"   version_ge 26.9.5 26.9.5
assert_ok    "26.10.1 >= 26.9.5"  version_ge 26.10.1 26.9.5
assert_fails "26.9.2 >= 26.9.5"   version_ge 26.9.2 26.9.5
assert_fails "26.8.11 >= 26.9.5"  version_ge 26.8.11 26.9.5
assert_ok    "v26.9.5 >= 26.9.5"  version_ge v26.9.5 26.9.5
assert_ok    "macOS 26.4 >= 26.2" version_ge 26.4 26.2
assert_fails "macOS 15.6 >= 26.2" version_ge 15.6 26.2

# ---- binary resolution + pinned install -----------------------------------
mk_mlxserve_stub() { # path version
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<STUB
#!/usr/bin/env bash
[[ "\${1:-}" == "--version" ]] && { echo "mlx-serve $2"; echo "mlx 0.32.2"; exit 0; }
exit 0
STUB
  chmod +x "$1"
}

BH="$WORK/bhome"; mkdir -p "$BH"
mk_mlxserve_stub "$WORK/oldbin/mlx-serve" 26.8.8          # e.g. an old Homebrew install
mk_mlxserve_stub "$WORK/newbin/mlx-serve" 26.9.6          # a newer one outside HOME
mkdir -p "$WORK/tarsrc/mlx-serve-macos-arm64/lib"
mk_mlxserve_stub "$WORK/tarsrc/mlx-serve-macos-arm64/mlx-serve" 26.9.5
: > "$WORK/tarsrc/mlx-serve-macos-arm64/lib/libmlxc.dylib"
tar -czf "$WORK/release.tar.gz" -C "$WORK/tarsrc" mlx-serve-macos-arm64
TAR_SHA="$(shasum -a 256 "$WORK/release.tar.gz" | cut -d' ' -f1)"

resolve() { # extra PATH dir, sha -> prints "BIN|REL|SYS|ORIGIN"
  ( HOME="$BH"; PATH="$1:/usr/bin:/bin:/usr/sbin"
    MLXSERVE_VERSION=26.9.5 MLXSERVE_TARBALL_SHA256="$2"
    MLXSERVE_TARBALL_URL="file://$WORK/release.tar.gz"
    . "$REPO_ROOT/lib/mlxserve.sh"
    ensure_backend >/dev/null 2>&1 || exit 1
    printf '%s|%s|%s|%s' "$MLXSERVE_BIN" "$MLXSERVE_BIN_REL" "$MLXSERVE_BIN_SYS" "$MLXSERVE_BIN_ORIGIN" )
}

out="$(resolve "$WORK/oldbin" "$TAR_SHA")"
IFS='|' read -r r_bin r_rel r_sys r_origin <<< "$out"
assert_eq "an mlx-serve older than the floor is not used" "" "$(printf '%s' "$r_bin" | grep oldbin)"
assert_ok "the pinned release is unpacked under HOME" test -x "$BH/.local/share/awesome-local-ai/mlx-serve/v26.9.5/mlx-serve-macos-arm64/mlx-serve"
assert_eq "the manifest gets a HOME-relative path" \
  ".local/share/awesome-local-ai/mlx-serve/v26.9.5/mlx-serve-macos-arm64/mlx-serve" "$r_rel"
assert_eq "...and no system path" "" "$r_sys"
assert_eq "the old install is left untouched" "mlx-serve 26.8.8" "$("$WORK/oldbin/mlx-serve" --version | head -1)"
assert_ok "the downloaded tarball is not left behind" \
  bash -c "! ls '$BH/.local/share/awesome-local-ai/mlx-serve/v26.9.5/'*.tar.gz 2>/dev/null"

mv "$WORK/release.tar.gz" "$WORK/release.tar.gz.away"
out="$(resolve "$WORK/oldbin" "$TAR_SHA")"
IFS='|' read -r r_bin r_rel r_sys r_origin <<< "$out"
assert_eq "second run: reuses the unpacked copy, no download" "pinned, already unpacked" "$r_origin"
mv "$WORK/release.tar.gz.away" "$WORK/release.tar.gz"

rm -rf "$BH/.local/share/awesome-local-ai"
assert_fails "a tarball with the wrong sha256 is refused" resolve "$WORK/oldbin" "$(printf '0%.0s' {1..64})"
assert_fails "...and nothing is unpacked" test -e "$BH/.local/share/awesome-local-ai/mlx-serve/v26.9.5/mlx-serve-macos-arm64"

out="$(resolve "$WORK/newbin" "$TAR_SHA")"
IFS='|' read -r r_bin r_rel r_sys r_origin <<< "$out"
assert_eq "a new-enough mlx-serve on PATH is used as it is" "$WORK/newbin/mlx-serve" "$r_bin"
assert_eq "...recorded as a system path, not HOME-relative" "$WORK/newbin/mlx-serve|" "$r_sys|$r_rel"

# ---- weights: idempotent fetch --------------------------------------------
echo
echo "weights: pinned revision, marker, required files"
FH="$WORK/fhome"; mkdir -p "$FH/bin"
cat > "$FH/bin/hf" <<'STUB'
#!/usr/bin/env bash
echo "hf $*" >> "$HF_LOG"
exit 0
STUB
chmod +x "$FH/bin/hf"
PACK="$FH/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
mkdir -p "$PACK"
echo '{"weight_map":{"a":"model-00001.safetensors","b":"model-00002.safetensors"}}' > "$PACK/model.safetensors.index.json"
for f in model-00001.safetensors model-00002.safetensors ngram_table.bin tokenizer.json; do echo "$f" > "$PACK/$f"; done
for f in config.json generation_config.json chat_template.jinja tokenizer_config.json; do echo '{}' > "$PACK/$f"; done
FETCH_SHA="$(cd "$PACK" && shasum -a 256 model-00001.safetensors model-00002.safetensors ngram_table.bin tokenizer.json)"

fetch() { # extra env assignments... ; prints MODEL_SUBDIR|MODEL_ARTIFACT basename
  ( HOME="$FH"; PATH="$FH/bin:/usr/bin:/bin"; export HF_LOG="$WORK/hf.log"
    . "$REPO_ROOT/lib/mlxserve.sh"
    ensure_hf() { :; }                   # never pip-install anything from a test
    MODEL_REPO="ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
    MODEL_REVISION="7eaef0fa82b4c3bf5c64cec60ace4bf48fd271e3"
    MODEL_WEIGHTS_DIR="$MODEL_REPO"; MODEL_DISPLAY_NAME="test pack"
    MODEL_SHA256="$FETCH_SHA"; MODEL_DISK_KB="${DISK_KB:-1}"
    backend_fetch_model >"$WORK/fetch.out" 2>&1 || exit 1
    printf '%s|%s' "$MODEL_SUBDIR" "$(basename "$MODEL_ARTIFACT")" )
}
hf_calls() { [[ -f "$WORK/hf.log" ]] && wc -l < "$WORK/hf.log" | tr -d ' ' || echo 0; }

out="$(fetch)"
assert_eq "first run: downloads once via hf at the pinned revision" 1 "$(hf_calls)"
assert_ok "...with --revision <commit> into mlx-serve's store" \
  grep -q -- "download ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit --revision 7eaef0fa82b4c3bf5c64cec60ace4bf48fd271e3 --local-dir $PACK" "$WORK/hf.log"
assert_eq "manifest paths are HOME-relative" ".mlx-serve/models/ddalcu|Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit" "$out"
assert_ok "a verification marker was written" test -f "$PACK/.awesome-local-ai-verified"
out="$(fetch)"
assert_eq "second run: no download at all" 1 "$(hf_calls)"

rm -f "$PACK/.awesome-local-ai-verified" "$PACK/ngram_table.bin"
assert_fails "a pack without its n-gram table is refused" fetch
assert_ok "...naming the missing file" grep -q 'missing ngram_table.bin' "$WORK/fetch.out"
echo ngram_table.bin > "$PACK/ngram_table.bin"
echo "tampered" > "$PACK/model-00002.safetensors"
assert_fails "a shard that fails its sha256 is refused" fetch
assert_ok "...as a sha256 mismatch" grep -q 'sha256 mismatch for model-00002.safetensors' "$WORK/fetch.out"
echo model-00002.safetensors > "$PACK/model-00002.safetensors"
: > "$WORK/hf.log"
assert_fails "not enough disk: refused before any download" env DISK_KB=999999999999 bash -c "$(declare -f fetch hf_calls); FH='$FH' WORK='$WORK' REPO_ROOT='$REPO_ROOT' PACK='$PACK' FETCH_SHA='$FETCH_SHA' LOG_FILE='$LOG_FILE'; . '$REPO_ROOT/lib/common.sh'; fetch"
assert_eq "...and hf was never called" 0 "$(hf_calls)"
assert_ok "...for the disk reason, not another" grep -q 'Not enough disk' "$WORK/fetch.out"

# ---- the combination's data ------------------------------------------------
echo
echo "combination config"
assert_ok "opts out of automatic selection"       grep -qE '^AUTO_SELECT=0$' "$CFG"
assert_ok "backend is mlxserve"                   grep -qE '^BACKEND="mlxserve"' "$CFG"
assert_ok "revision is a full commit"             grep -qE '^MODEL_REVISION="[0-9a-f]{40}"' "$CFG"
assert_ok "release tarball pinned by sha256"      grep -qE '^MLXSERVE_TARBALL_SHA256="[0-9a-f]{64}"' "$CFG"
assert_ok "mlx-serve floor is 26.9.5"             grep -qE '^MLXSERVE_VERSION="26\.9\.5"' "$CFG"
assert_eq "a hash for all 103 LFS files" 103 "$(bash -c ". '$CFG'; printf '%s\n' \"\$MODEL_SHA256\" | grep -cE '^[0-9a-f]{64}  '")"
assert_ok "...including the n-gram table"        grep -qE '^[0-9a-f]{64}  ngram_table\.bin$' "$CFG"
assert_ok "effort: only what mlx-serve does"      grep -qE '^REASONING_EFFORTS="default low"$' "$CFG"
PT="$REPO_ROOT/combinations/$COMBO/profiles.tsv"
assert_ok "profiles.tsv declares the mlxserve schema on line 1" \
  bash -c "head -1 '$PT' | grep -qx '# $PROFILE_SCHEMA'"
assert_ok "every profile row has 8 columns" \
  bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && NF!=8 {bad=1} END{exit bad}' '$PT'"
assert_ok "every profile row is labelled ESTIMATED (nothing measured)" \
  bash -c "awk -F'|' '!/^[[:space:]]*(#|\$)/ && \$7!=\"ESTIMATED\" {bad=1} END{exit bad}' '$PT'"
assert_eq "default profile ctx matches CONTEXT_LIMIT" \
  "$(bash -c ". '$CFG'; echo \$CONTEXT_LIMIT")" "$(awk -F'|' '$1=="agent"{print $2}' "$PT")"

# ---- the launcher, end to end against stubs --------------------------------
echo
echo "launcher"
LH="$WORK/lhome"; X="$LH/.local/share/x"; mkdir -p "$LH/bin" "$X"
LPACK="$LH/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
mkdir -p "$LPACK"
echo '{"model_type":"qwen4_exp"}' > "$LPACK/config.json"
echo '{"weight_map":{}}' > "$LPACK/model.safetensors.index.json"
echo '{"temperature": 1.0, "top_k": 20, "top_p": 0.95}' > "$LPACK/generation_config.json"
: > "$LPACK/ngram_table.bin"
(
  set -e
  . "$CFG"
  . "$REPO_ROOT/lib/mlxserve.sh"
  MLXSERVE_BIN_REL="bin/mlx-serve"; MLXSERVE_BIN_SYS=""
  {
    printf 'INSTALL_ID=%q\nDISPLAY_NAME=%q\nBACKEND=mlxserve\nACCEL=metal\n' "$INSTALL_ID" "$DISPLAY_NAME"
    printf 'MODEL_SUBDIR=.mlx-serve/models/ddalcu\nMODEL_FILE=Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit\n'
    printf 'MODEL_ALIAS_DEFAULT=%q\nDEFAULT_PROFILE=%q\nDEFAULT_PORT=%q\n' "$MODEL_ALIAS_DEFAULT" "$DEFAULT_PROFILE" "$DEFAULT_PORT"
    printf 'REASONING_EFFORT_DEFAULT=%q\nREASONING_EFFORTS=%q\n' "$REASONING_EFFORT_DEFAULT" "$REASONING_EFFORTS"
    printf 'SAMPLING_THINKING=%q\nSAMPLING_INSTRUCT=%q\nSERVER_CMD=test-server\n' "$SAMPLING_THINKING" "$SAMPLING_INSTRUCT"
    backend_manifest_extra
  } > "$X/install.env"
  cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$X/"
)
cat > "$LH/bin/mlx-serve" <<'STUB'
#!/usr/bin/env bash
# records its argv one per line; with MLXS_IDLE=1 it idles until SIGTERM
printf '%s\n' "$@" > "$ARGV"
if [[ "${MLXS_IDLE:-0}" == "1" ]]; then
  trap 'echo TERM >> "$TERMFILE"; exit 0' TERM
  while :; do sleep 0.1; done
fi
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 7\n' > "$LH/bin/curl"                       # nothing is serving
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "${PS_OUT:-}"\n' > "$LH/bin/ps"
printf '#!/usr/bin/env bash\necho "System-wide memory free percentage: ${MP_PCT:-90}%%"\n' > "$LH/bin/memory_pressure"
printf '#!/usr/bin/env bash\necho 137438953472\n' > "$LH/bin/sysctl"          # 128 GiB
chmod +x "$LH/bin/"*

ARGV="$WORK/argv"
launch() { # env... -- runs the launcher under the fake home; argv lands in $ARGV
  env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x \
      ARGV="$ARGV" TERMFILE="$WORK/term" PORT=39997 "$@" \
      bash "$REPO_ROOT/lib/runtime/server-mlxserve.sh" >"$WORK/launch.out" 2>&1
}
has_arg()  { grep -qxF -- "$1" "$ARGV"; }
has_pair() { awk -v a="$1" -v b="$2" 'p==a && $0==b {f=1} {p=$0} END{exit !f}' "$ARGV"; }
SERVED="$X/served/mlxserve-flash-next-mixed-4-8bit"
gen_thinking() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["default_chat_template_kwargs"]["enable_thinking"])' "$SERVED/generation_config.json"; }

rm -f "$ARGV"; launch
assert_ok "agent: serves the symlinked dir (its name is the model id)" has_pair --model "$SERVED"
assert_ok "agent: --serve"                          has_arg --serve
assert_ok "agent: loopback bind"                    has_pair --host 127.0.0.1
assert_ok "agent: port from PORT"                   has_pair --port 39997
assert_ok "agent: --ctx-size 131072"                has_pair --ctx-size 131072
assert_ok "agent: --mtp"                            has_arg --mtp
assert_ok "agent: --kv-quant off"                   has_pair --kv-quant off
assert_ok "agent: --max-tokens 32768"               has_pair --max-tokens 32768
assert_ok "agent: one request at a time"            has_pair --max-concurrent 1
assert_ok "agent: one resident model"               has_pair --max-resident-models 1
assert_ok "agent: 16 GiB OS reserve"                has_pair --os-reserve-gib 16
assert_ok "agent: vision off by default"            has_arg --no-vision
assert_ok "agent: the checkpoint's sampler"         has_pair --temp 1.0
assert_fails "agent: no reasoning budget unless asked" has_arg --reasoning-budget
assert_ok "served dir links the pack's files"       test -L "$SERVED/config.json"
assert_ok "...the n-gram table included"            test -L "$SERVED/ngram_table.bin"
assert_fails "...but generation_config.json is a real file" test -L "$SERVED/generation_config.json"
assert_eq "thinking on by default, server-side"     "True" "$(gen_thinking)"
assert_eq "the pack's own sampling fields are kept" "20" \
  "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["top_k"])' "$SERVED/generation_config.json")"
assert_eq "the pack itself is not modified" '{"temperature": 1.0, "top_k": 20, "top_p": 0.95}' "$(cat "$LPACK/generation_config.json")"

rm -f "$ARGV"; launch PROFILE=serial
assert_ok    "serial: --no-mtp"                     has_arg --no-mtp
assert_fails "serial: not --mtp"                    has_arg --mtp

rm -f "$ARGV"; launch PROFILE=lean
assert_ok "lean: --ctx-size 65536"                  has_pair --ctx-size 65536
assert_ok "lean: --kv-quant 8"                      has_pair --kv-quant 8

rm -f "$ARGV"; launch THINKING=0
assert_eq "THINKING=0 -> enable_thinking false"     "False" "$(gen_thinking)"
assert_ok "THINKING=0 -> the instruct sampler"      has_pair --temp 0.7

rm -f "$ARGV"; launch REASONING_EFFORT=low REASONING_BUDGET=4096 VISION=1
assert_ok    "REASONING_EFFORT=low is accepted"     test -f "$ARGV"
assert_ok    "REASONING_BUDGET -> --reasoning-budget" has_pair --reasoning-budget 4096
assert_fails "VISION=1 keeps the vision tower"      has_arg --no-vision

rm -f "$ARGV"
assert_fails "an effort mlx-serve cannot apply is refused before launch" launch REASONING_EFFORT=medium
assert_fails "...and mlx-serve was never run"       test -f "$ARGV"
assert_fails "a non-numeric REASONING_BUDGET is refused" launch REASONING_BUDGET=lots
assert_fails "an unknown profile is refused"        launch PROFILE=nope
assert_fails "a LAN bind without an API key is refused" launch HOST=0.0.0.0
rm -f "$ARGV"; launch HOST=0.0.0.0 MLXSERVE_API_KEY=k
assert_ok "...and allowed with one"                 has_pair --api-key k

rm -f "$ARGV"
env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x ARGV="$ARGV" \
    bash "$REPO_ROOT/lib/runtime/server-mlxserve.sh" --help >"$WORK/launch.out" 2>&1
assert_fails "--help runs nothing"                  test -f "$ARGV"
assert_ok "--help renders the profile table"        grep -qE '^  agent +131072 ctx  mtp on ' "$WORK/launch.out"
assert_ok "--help carries the honesty note"         grep -q 'NOT MEASURED BY THIS REPO' "$WORK/launch.out"

echo
echo "launcher: memory safety"
rm -f "$ARGV"
assert_fails "MTPLX running -> refused" \
  launch PS_OUT="  4242 /opt/homebrew/bin/Python -P -m mtplx.server.openai --model x"
assert_fails "...mlx-serve never started"           test -f "$ARGV"
assert_ok "...the refusal names the other server"   grep -q 'mtplx.server.openai' "$WORK/launch.out"
assert_fails "llama-server running -> refused"      launch PS_OUT="  99 /usr/local/bin/llama-server -m x.gguf"
assert_ok "an unrelated 'workerd serve' is not a model server" \
  launch PS_OUT="  77 /x/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve --binary"
rm -f "$ARGV"; launch ALLOW_COEXIST=1 PS_OUT="  4242 python -m mtplx.server.openai"
assert_ok "ALLOW_COEXIST=1 overrides"               test -f "$ARGV"
rm -f "$ARGV"
assert_fails "free memory below estimate + headroom -> refused" launch MP_PCT=40
assert_fails "...mlx-serve never started"           test -f "$ARGV"
assert_ok "...and says not to raise the wired limit" grep -q 'iogpu.wired_limit_mb' "$WORK/launch.out"
rm -f "$ARGV"; launch MP_PCT=40 FORCE_LOW_MEM=1
assert_ok "FORCE_LOW_MEM=1 overrides (after a warning)" test -f "$ARGV"

echo
echo "launcher: SIGTERM reaches mlx-serve"
rm -f "$ARGV" "$WORK/term"
env -i PATH="$LH/bin:/usr/bin:/bin" HOME="$LH" LOCAL_AI_INSTALL_REL=.local/share/x \
    ARGV="$ARGV" TERMFILE="$WORK/term" PORT=39996 MLXS_IDLE=1 \
    bash "$REPO_ROOT/lib/runtime/server-mlxserve.sh" >/dev/null 2>&1 &
lpid=$!
for _ in $(seq 1 50); do [[ -s "$ARGV" ]] && break; sleep 0.1; done
kill -TERM "$lpid" 2>/dev/null
for _ in $(seq 1 50); do kill -0 "$lpid" 2>/dev/null || break; sleep 0.1; done
assert_ok    "the launcher exec'd mlx-serve (same pid got the signal)" grep -qx TERM "$WORK/term"
assert_fails "and it exited"                        kill -0 "$lpid"
kill -9 "$lpid" 2>/dev/null || true

finish
