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
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next MLX oQ4 with MTP head (TensorFold)"
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
# 0.6.2 (2 Oct 2026) is the latest release; this combination was first written against 0.6.0 (30 Sep), and the
# notes below that cite 0.6.0 were read from that source. 0.6.1 widened Flash Next's fitted window on Macs after a
# short request; 0.6.2 speeds Flash Next on Macs at 64k-128k (release notes). The long-context fix (issue 71) is in 0.3.6.3; 0.4.0 added Flash-Next's
# mixed and 2-8-bit checkpoints on Macs. Pinned by the commit its tag points at (git ls-remote / the GitHub API).
TENSORFOLD_VERSION="0.6.2"
TENSORFOLD_COMMIT="56e2e3ec55bc0ae1d7d5158c4fa2c79a3567ab21"
# pyproject.toml: requires-python >= 3.11. A uv-managed CPython, so the Mac's own Python is not involved.
TENSORFOLD_PYTHON="3.12"
# The process memory budget (TENSORFOLD_MEMORY_LIMIT_GB, GiB, read as a float). Not mlx-serve's 16 GiB OS reserve
# (112 here): TensorFold's own default is 70% of RAM (89.6 here). Left at the default after a measured attempt to
# raise it made things worse, not better (2 Oct 2026; see horizon/tensorfold.md for the full record):
#   - At 89.6 GiB: check 1 passed to 32k tokens; keep-prompt limit 48,128 (still short of our ~131k sessions, but
#     via the window ceiling, not an out-of-memory failure).
#   - TENSORFOLD_PLE_ON_SSD=1 (below) at the same 89.6 GiB: no measured difference (identical 48,128 limit,
#     identical check 2 failure). TensorFold's own recipe doc says this machine class already host-maps the
#     n-gram tables by default, so the flag was redundant here. Left on: harmless either way per that doc.
#   - Raised to 110 (TensorFold's own worked example for a 128 GiB Mac, docs/recipes/qwen3.8-flash-next.md): the
#     keep-prompt limit *fell* to 10,240 — worse than the 89.6 GiB default, the opposite of what raising the
#     budget should do. Cause, read from the 0.6.0 source: at that budget it picks 8,192-token prompt chunks (2,048
#     at 89.6), whose working memory takes the gain. Reverted. A later sweep of budgets between 94 and 105 GiB
#     restarted this Mac: nothing above 89.6 runs here without the owner's say (horizon/tensorfold.md).
# The 24 Sep 2026 panic this budget used to guard against was MTPLX, a different engine, confounded by a ~10 GiB
# leak since removed (docs/20260924-mtplx-memory-report.md) — not evidence against TensorFold specifically.
# TensorFold refuses to load, naming the budget it needs, when the model doesn't fit; its startup line says where
# the budget landed.
TENSORFOLD_MEMORY_LIMIT_GB=89.6
# One request at a time, as mlx-serve is run (--max-concurrent 1).
TENSORFOLD_PARALLEL=1
# See the TENSORFOLD_MEMORY_LIMIT_GB comment above: tried 2 Oct 2026, no measured effect at 89.6 GiB. Left on:
# harmless per TensorFold's own recipe doc (peak memory measured lower with it than without, never higher).
TENSORFOLD_PLE_ON_SSD=1

# ---- weights --------------------------------------------------------------
# Not the mlx-serve combination's weights. That pack (ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit @ 7eaef0fa)
# keeps its n-gram tables in a separate ngram_table.bin (config.json "ngram_table": {"file": "ngram_table.bin"}),
# mlx-serve's own layout; TensorFold 0.6.0 reads n-gram tables only as ...ngram_embedding.shard_N tensors inside the
# safetensors (families/qwen4_exp/host_table.py from_checkpoint) and has no reader for that file. So the comparison
# with mlx-serve is NOT same-weights: uniform 4-bit (group 32) here against mixed 4/8-bit there.
# TensorFold's own conversion (published 1 Oct 2026), mixed precision (oQ4) from the official BF16 weights with the
# MTP block kept. Until 2 Oct 2026 this was Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP @ dadefa80, uniform 4-bit: the
# checks run that day (horizon/tensorfold.md) used that one.
MODEL_REPO="TensorFold/Qwen3.8-Flash-Next-MLX-oQ4-MTP"
MODEL_REVISION="069090c38f60e654c08ac6cb8cd83fce1affbdbc"
# From the Hugging Face file list at MODEL_REVISION: 35 files, 113,348,684,986 B in all, 22 of them shards. About 29.8 GiB
# of it is n-gram tables, which TensorFold keeps in file mappings, not wired memory.
MODEL_APPROX_SIZE="113.3 GB (105.6 GiB)"
MODEL_DISK_KB=110692075
# The Hugging Face LFS sha256 of every large file at MODEL_REVISION.
MODEL_SHA256="
d417144635b37be24467586d06749611d3de81003663205c83db0b1c94a5c903  model-00001-of-00022.safetensors
4acddf6f8bb11a26ddaca9b9ae917567ae32013f779e96567410169bbac9a113  model-00002-of-00022.safetensors
51921c66850802fca6c09109b8d6a7b224296ac537a8d8cd9086c55ef0932434  model-00003-of-00022.safetensors
4da779ebbaaef604fb5e11353d925d2a98641ed9ba3056b46b845f50f2056d8e  model-00004-of-00022.safetensors
b2afbaf8179aceab3537f211e7261656f7834176b24e8f723958e6de8f3767a1  model-00005-of-00022.safetensors
d760f4cec3a9b4b37ac2b6735722f6733a4879a1d0105b6ef8080a1772746d56  model-00006-of-00022.safetensors
94ca752bed363970fe9b934936c058729319d233943445e468b5f174ae818249  model-00007-of-00022.safetensors
2fb4369163af02fdef86880e8c221e93f04a6043edf0c78c4fc0112a9586ad80  model-00008-of-00022.safetensors
0af6ef5ed6f06baa7df38f566d023feb87b7c094460b585e9f2373005820edac  model-00009-of-00022.safetensors
6bc4d643b2e8118582c6dda92d5639644826f31a034df36e1a47af143700d6f4  model-00010-of-00022.safetensors
9b23288c7d6f98d8f3611333dc8f7151ee708d6c033cae5e97a69ff5c2d72eea  model-00011-of-00022.safetensors
96955e1b7f825c4bb369903acdae863519ede270042b9f16160b6af7f0e7a445  model-00012-of-00022.safetensors
24a48199cc9ce36ff966f32f9cd5f8d5825c12c0b4b2676c3daeb2c7b5fccc5c  model-00013-of-00022.safetensors
9f1b204e1cb093c2f178322ecc0df7db20fe282a5b827856caae4d0a884f1aa2  model-00014-of-00022.safetensors
1d43d193cd68e4a615fc9373f3a5e811ee8870ed8c9e62ca83f49457c731149b  model-00015-of-00022.safetensors
ab2d9b143caaa58476558aa10f05e261d4038cdee771216ab1f4e957b1ffbe3c  model-00016-of-00022.safetensors
10650475107c1ef15de5881f35a559f801a1ca3bf92ec6df1e7258bf75ec97ea  model-00017-of-00022.safetensors
dd8b2547ac04e15b0f232a9be2f3a7778dc39e6767a3e64e2c5f523e7972e5d2  model-00018-of-00022.safetensors
163655acdc2ac24bbb6d9dd830895310f8795965f78f13a26c1671743f5fe9f2  model-00019-of-00022.safetensors
6ddb7c20db486887b2396eb29a8163946f86ade6e1d16fe0fb7e904eac39eee9  model-00020-of-00022.safetensors
824ef152cbbdf30d1a9f87e3beee03660cc3320a62a9c5cac7abe22657d16463  model-00021-of-00022.safetensors
acca79b029b521fdab2c40dba168e77799a126e219b46c92937566f7878b198c  model-00022-of-00022.safetensors
0997f410c57a1f4e53b09e4be8f4a172d90edd9564368fb0847030937229b9f3  tokenizer.json
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="tensorfold-flash-next-oq4"   # the id at /v1/models (--name)
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
