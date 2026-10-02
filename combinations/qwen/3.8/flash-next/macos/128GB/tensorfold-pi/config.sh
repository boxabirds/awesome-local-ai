#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/macos/128GB/tensorfold-pi/config.sh
#
# Qwen3.8-Flash-Next on a 128 GB Apple silicon Mac, served by TensorFold (github.com/ashhart/TensorFold: exact
# speculative decoding with the checkpoint's own MTP head) from Vontra's uniform MLX 4-bit checkpoint, driven by pi.
#
# This file is DATA. The logic lives in lib/tensorfold.sh and lib/runtime/server-tensorfold.sh.
#
# NOT MEASURED BY THIS REPO, and NOT YET CLEARED TO RUN: the owner ruled TensorFold's long-context behaviour a
# blocker (horizon/tensorfold.md). tools/tensorfold-check/run-checks.sh runs the acceptance checks; only after they
# pass is the one-story smoke test it prints submitted. Sources (read 2026-10-01):
#   https://github.com/ashhart/TensorFold  @ v0.6.0 = c4646171 (README, docs/api.md, docs/recipes/qwen3.8-flash-next.md,
#     src/tensorfold/cli.py, cli_args.py, families/qwen4_exp/)
#   https://huggingface.co/Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP  @ dadefa80 (card, config, file list)

# ---- identity -------------------------------------------------------------
INSTALL_ID="tensorfold-qwen38-flash-next"
DISPLAY_NAME="Qwen3.8-Flash-Next (TensorFold)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next MLX 4-bit with MTP head (Vontra)"
ROOT_ENV_VAR="TENSORFOLD_FLASH_NEXT_ROOT"

# Never the automatic pick: unmeasured, and blocked until its acceptance checks pass.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="tensorfold"                      # -> lib/tensorfold.sh
CLIENT="${CLIENT:-pi}"
SYSTEM_PACKAGES=()

# The same floor as the other Flash-Next combinations on this Mac: ~76 GiB of resident weights plus a usable context.
MIN_DEVICE_MEM_MIB=92000

# ---- backend --------------------------------------------------------------
# 0.6.0 (30 Sep 2026) is the latest release. The long-context fix (issue 71) is in 0.3.6.3; 0.4.0 added Flash-Next's
# mixed and 2-8-bit checkpoints on Macs. Pinned by the commit its tag points at (git ls-remote / the GitHub API).
TENSORFOLD_VERSION="0.6.0"
TENSORFOLD_COMMIT="c4646171139ee8a3c38103eaa1699dad226ec12b"
# pyproject.toml: requires-python >= 3.11. A uv-managed CPython, so the Mac's own Python is not involved.
TENSORFOLD_PYTHON="3.12"
# The process memory budget (TENSORFOLD_MEMORY_LIMIT_GB, GiB, read as a float). Not mlx-serve's 16 GiB OS reserve
# (112 here): TensorFold's own default is 70% of RAM (89.6 here), which this combination started from (2 Oct
# 2026). At 89.6 GiB, check 1 (long-context cache retention) passed cleanly but only to 32k tokens — the budget's
# own keep-prompt limit (48,128) capped it well short of our ~131k sessions, before any out-of-memory condition
# occurred. TENSORFOLD_PLE_ON_SSD=1 (below) was tried first as the lower-risk lever and made no measured
# difference on this machine (identical 48,128 limit, identical check 2 failure at turn 12) — TensorFold's own
# recipe doc says this machine class already host-maps the n-gram tables by default, so the flag was redundant
# here. Raised to 110 (2 Oct 2026): TensorFold's own worked example for a 128 GiB Mac
# (docs/recipes/qwen3.8-flash-next.md: "TENSORFOLD_MEMORY_LIMIT_GB=110 gives a 128 GiB M4 Max a 110 GiB process
# budget and 107 GiB for MLX"), not a value we chose unguided. The panic this budget used to guard against (24 Sep
# 2026) was MTPLX, a different engine, confounded by a ~10 GiB leak since removed
# (docs/20260924-mtplx-memory-report.md) — its peak was 97.2 GiB, under this new budget. TensorFold refuses to
# load, naming the budget it needs, when the model doesn't fit; its startup line says where the budget landed.
TENSORFOLD_MEMORY_LIMIT_GB=110
# One request at a time, as mlx-serve is run (--max-concurrent 1).
TENSORFOLD_PARALLEL=1
# Tried 2 Oct 2026 as the lower-risk lever before raising the memory budget above: no measured effect on this
# machine (see that comment). Left on: harmless (TensorFold's own recipe doc: peak memory measured lower with it
# than without, never higher), and it may matter again if TENSORFOLD_MEMORY_LIMIT_GB changes.
TENSORFOLD_PLE_ON_SSD=1

# ---- weights --------------------------------------------------------------
# Not the mlx-serve combination's weights. That pack (ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit @ 7eaef0fa)
# keeps its n-gram tables in a separate ngram_table.bin (config.json "ngram_table": {"file": "ngram_table.bin"}),
# mlx-serve's own layout; TensorFold 0.6.0 reads n-gram tables only as ...ngram_embedding.shard_N tensors inside the
# safetensors (families/qwen4_exp/host_table.py from_checkpoint) and has no reader for that file. So the comparison
# with mlx-serve is NOT same-weights: uniform 4-bit (group 32) here against mixed 4/8-bit there.
MODEL_REPO="Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP"
MODEL_REVISION="dadefa8066e3be900a0d148d0f5a2f4eb1cf6534"
# From the Hugging Face file list at MODEL_REVISION: 22 shards (113,209,682,735 B) and small files. About 29.8 GiB
# of it is n-gram tables, which TensorFold keeps in file mappings, not wired memory.
MODEL_APPROX_SIZE="113.2 GB (105.5 GiB)"
MODEL_DISK_KB=110579149
# The Hugging Face LFS sha256 of every large file at MODEL_REVISION.
MODEL_SHA256="
308f20b7e35a3e525f36eca0df286f6d1043cfeb621e7bbcf372a834c99cd66d  model-00001-of-00022.safetensors
8af1a616f2f39dbfe6ee92e959afb2414623fcb299aff1ced55984bfe810d608  model-00002-of-00022.safetensors
519a0472252ac9a51af020686f462aa6be82ce655f948fd5f054d70949de17a6  model-00003-of-00022.safetensors
b1ad7e951969eb8dc4e92762dc2e50bd47353c95990ae207db5da393d441400f  model-00004-of-00022.safetensors
9ca797304c563bb65f2356b67d444511b11744bc5b5c8ec8345ae7d97d3e251c  model-00005-of-00022.safetensors
8aab4c1dce7d8a0af645426b66d1caf30245d422d4c6b7029583959d675a1827  model-00006-of-00022.safetensors
7908da37b2e3fa7f0de8b9734dad0759be7dc445716f3acd59c20c4842638db9  model-00007-of-00022.safetensors
85beff20f250bfe63e95f12c0460512aab92bcde8f7408fe9c20e3de0321bc1d  model-00008-of-00022.safetensors
f7c03ae640e9bf0f7813ef2b2980afa83a883c02b3988e814e9921055fc08a28  model-00009-of-00022.safetensors
6897f52227533e720b243d6aef24c1293ad1eb02a1bb2ec6a6e4dc48d56d0c8f  model-00010-of-00022.safetensors
905d27f9db887284289a043f9638020258c5f90d52122cdce2e7aef941a431f2  model-00011-of-00022.safetensors
c4d2bb76fa4613f7386ddaa7045608c320f9736623211a814aa28fb370530dec  model-00012-of-00022.safetensors
1f20a5e1f2256b2fb6a78fef52f9e66daa970f4318ab1be3abb32a1effedbbf3  model-00013-of-00022.safetensors
860d12691792df5f08c9dfe245dc356773741f1edcc1fd430672ef06ac387635  model-00014-of-00022.safetensors
259fb7577b8248f6dcbe6a932fe5d2f1c8869eda761ef3394fe6ad06065f216c  model-00015-of-00022.safetensors
e931785f9ff4e0a567bf8c06df37639be46b4dae156e0f8b39b9d32a03d75792  model-00016-of-00022.safetensors
4f4610dc4a862bf9d93d70cfd0ec037e8e7943a734794d34eb5c0d748b74747a  model-00017-of-00022.safetensors
afdb4828920186600f9d61537d1465979fb36692f4eddb8c5a961a6b72964b77  model-00018-of-00022.safetensors
869d34c6e8f7db79bd4e54b9833d5b0db45eefac860c9bd64fbd312bf862a667  model-00019-of-00022.safetensors
5ca2f994fec1aa06fefef6646b9f072cf70f7f73aa8dab4c7c1a9a424afb4a52  model-00020-of-00022.safetensors
58def6762f29cc798437e5649a56ee75d053faca69138a2454dbdb34bb8a37c3  model-00021-of-00022.safetensors
30a3c82b573d813a1d2349f1c05c308c0d415f3ca1bb67caa0bfaad8a6afa7a3  model-00022-of-00022.safetensors
0997f410c57a1f4e53b09e4be8f4a172d90edd9564368fb0847030937229b9f3  tokenizer.json
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="tensorfold-flash-next-4bit"   # the id at /v1/models (--name)
DEFAULT_PROFILE="agent"
DEFAULT_PORT=8012                         # clear of the MTPLX sibling's 8010 and mlx-serve's 8011

# The checkpoint's generation_config.json at this revision: temperature 1.0, top_p 0.95, top_k 20. Passed
# explicitly so the command line says what runs.
SAMPLING_THINKING="--temperature 1.0 --top-p 0.95 --top-k 20"

# TensorFold applies an effort server-side for requests that name none (--reasoning-effort); pi sends none.
# Without it Qwen3.8's template renders its own default, xhigh. The owner set low for Flash-Next.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="low medium high xhigh"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="tensorfold"
# pi's context window. PROVISIONAL until check 1: TensorFold fits its own window to what keeps a prompt for the
# next turn (the "keep-prompt limit" its startup line states), and every pi request reserves OUTPUT_LIMIT reply
# tokens out of it. pi compacts once its context passes CONTEXT_LIMIT - 16384, so CONTEXT_LIMIT must be at most
# keep-prompt limit - OUTPUT_LIMIT + 16384, and at most 131072 to match mlx-serve's runs.
# run-checks.sh prints the value to set here.
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This checkpoint keeps ~75.6 GiB of weights resident (TensorFold's own estimate) plus its"
  warn " cache and working memory; ${mem} MiB of GPU-addressable memory is not enough."
  warn " Do not raise iogpu.wired_limit_mb to force it."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO, and blocked until tools/tensorfold-check passes on this Mac.
TensorFold publishes no Flash-Next figures for an M5 Max; its memory table's 128 GB
row is "TBD" (README, 0.6.0).
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused: another server    stop mlx-serve/MTPLX/llama-server first (ALLOW_COEXIST=1 overrides)
Client errors near 100k    context_length_exceeded: pi's 32768-token reply reservation does
                           not fit the window; lower CONTEXT_LIMIT (see config.sh)
Startup refused: memory    the startup line says how far TENSORFOLD_MEMORY_LIMIT_GB must go
Slow turns late in a story check the server log: a turn past the keep-prompt limit prefills again
TXT
}
