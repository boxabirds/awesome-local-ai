# Qwen3.8-Flash-Next · macOS · 128GB Apple silicon · TensorFold + pi

Qwen3.8-Flash-Next from Vontra's uniform MLX 4-bit checkpoint with its native MTP head, served by
[TensorFold](https://github.com/ashhart/TensorFold), driven by pi.

> **NOT MEASURED BY THIS REPO, AND NOT YET CLEARED TO RUN.** The owner ruled TensorFold's long-context behaviour a
> blocker on 29 Sep 2026 ([horizon/tensorfold.md](../../../../../../../horizon/tensorfold.md)). Before any benchmark,
> `tools/tensorfold-check/run-checks.sh` must pass on this Mac: a pi conversation grown past 120k tokens that reuses
> its cache on every turn, and tool calls with pi's real requests. Then a one-story smoke test. Every figure here is
> read from TensorFold's source and documents at v0.6.0, or is an **ESTIMATE**. `./install.sh` never picks this
> combination on its own (`AUTO_SELECT=0`).

## Not the same weights as mlx-serve

The mlx-serve combination serves `ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit` (4-bit experts, 8-bit elsewhere).
TensorFold 0.4.0 added "Flash Next's 2-8-bit and mixed checkpoints on Macs", but that pack keeps its 32 GB of n-gram
tables in a separate `ngram_table.bin` (its `config.json` says `"ngram_table": {"file": "ngram_table.bin"}`), which is
mlx-serve's own layout. TensorFold reads n-gram tables only as `…ngram_embedding.shard_N` tensors inside the
safetensors (`families/qwen4_exp/host_table.py`) and has no reader for that file, so it cannot load the pack. This
combination uses the checkpoint TensorFold names for this model, `Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP`
(uniform 4-bit, group 32, MTP head and n-gram tables inside the shards). A comparison with mlx-serve is therefore an
engine-plus-quantisation comparison; say so wherever the two are set side by side.

## What this combination relies on (TensorFold v0.6.0, commit `c4646171`, 30 Sep 2026)

| | |
|---|---|
| Install | no release files; `pip install git+https://github.com/ashhart/TensorFold.git@v0.6.0`. Here: the exact commit into its own uv venv at `~/.local/share/awesome-local-ai/tensorfold/v0.6.0/venv`, checked against the package's `direct_url.json` (lib/tensorfold.sh). Python >= 3.11, MLX 0.32.2-0.32.3 |
| Serve | `tensorfold serve <dir or repo> --name <id> [--context N] [--port] …`; default `127.0.0.1:8080` |
| Endpoints | `/v1/chat/completions` (streaming), `/v1/completions`, `/v1/responses`, `/v1/models`, `/health`, `/metrics` |
| Tool calls | Qwen XML calls parsed into `tool_calls`, arguments typed from the offered schema, streamed as written; malformed calls stay text (docs/api.md) |
| Reasoning | `reasoning_effort` per request (`none`…`xhigh`; `high` maps to `xhigh`); server default `--reasoning-effort`; without one Qwen3.8's template uses `xhigh` |
| Usage | `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`, streamed too |
| Context | omitted `--context`: the window is fitted to "the most one request can use … and still keep its prompt for the next turn", printed at startup. An explicit reply limit is reserved before prefill; a prompt past the window gets `context_length_exceeded` |
| Drafting | the checkpoint's MTP head (3 drafts a round on a Mac); `--no-drafts` is the serial reference, with identical output |

## The server this combination runs

```
TENSORFOLD_MEMORY_LIMIT_GB=112 TENSORFOLD_NO_LIVE=1 TENSORFOLD_NO_UPDATE_CHECK=1 \
tensorfold serve ~/.local/share/awesome-local-ai/models/Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP \
  --host 127.0.0.1 --port 8012 --name tensorfold-flash-next-4bit --reasoning-effort low --max-tokens 32768 \
  --parallel 1 --snapshot-dir none --no-update-check --temperature 1.0 --top-p 0.95 --top-k 20
```

- **No `--context`:** TensorFold fits the window to what keeps a prompt for the next turn: the keep-prompt limit,
  which check 1 records. Our agent sessions reach about 131k tokens.
- **pi's context limit follows from it.** pi asks for 32,768 reply tokens on every request, and TensorFold reserves
  them out of the window before prefill; pi compacts once its context passes `CONTEXT_LIMIT - 16384`. So
  `CONTEXT_LIMIT` must be at most keep-prompt limit - 16,384, and at most 131,072 to match the mlx-serve runs.
  `config.sh` holds 131,072 until check 1 says otherwise; the check's driver prints the value to set.
- **Memory budget 112 GiB:** the same 16 GiB OS reserve mlx-serve runs with, capped by TensorFold at the GPU's
  recommended working set. Its default (70% of RAM, 89.6 GiB) would leave about 14 GiB beside the weights.
- **`--parallel 1`, `--snapshot-dir none`:** one request at a time and kept prompts in memory only, as mlx-serve runs.
- **Effort low, server-side:** pi sends no `reasoning_effort`.

## Files

- `config.sh`: pins (TensorFold commit, weights revision and sha256 of every large file), server settings.
- `profiles.tsv`: `agent` (drafts on) and `serial` (`--no-drafts`); both fitted windows. Memory figures are ESTIMATES.
- `help.txt`: what `--help` prints.

The launcher (`lib/runtime/server-tensorfold.sh`) and root installer this combination needs are staged under
`tools/tensorfold-check/staged/` until the owner approves moving them into place.
