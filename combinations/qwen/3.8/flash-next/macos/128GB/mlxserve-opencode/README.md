# Qwen3.8-Flash-Next · macOS · 128GB Apple silicon · mlx-serve + OpenCode

Qwen3.8-Flash-Next from its model author's own mixed 4/8-bit pack, served by
[mlx-serve](https://github.com/ddalcu/mlx-serve), driven by OpenCode or pi.

> **NOT MEASURED BY THIS REPO.** Nothing in this directory has been run on any
> machine by this repo. Every memory figure is an **ESTIMATE** from file sizes
> and the model config, with the arithmetic shown below. Every speed is the
> model author's, quoted with its source. Tool-calling and thinking behaviour
> are read from mlx-serve's source, not observed. `./install.sh` never picks
> this combination on its own (`AUTO_SELECT=0`); the measured
> [MTPLX combination](../mtplx-opencode/README.md) for the same model stays the
> default.

## Before you run it: one model server at a time

On 24 Sep 2026 a 128 GB M5 Max kernel-panicked from GPU memory exhaustion while
MTPLX served this model: a ~97 GiB peak at ~115k context, with a leaking 10 GB
third-party process resident beside it. The record is in the MTPLX
combination's Vidi run,
[interventions.md](../mtplx-opencode/benchmarks/vidi/canvas-pi-01/interventions.md).
What that means here:

- **Stop MTPLX (or any other model server) first.** This pack is ~70 GiB of
  weights; two servers of this class do not fit on one 128 GB Mac. The launcher
  refuses to start while MTPLX, llama-server, another mlx-serve, the MLX-Serve
  app, Ollama or LM Studio is running (`ALLOW_COEXIST=1` overrides).
- **Keep other heavy apps closed.** The launcher refuses when free memory is
  below the profile's estimate plus 8 GiB (`FORCE_LOW_MEM=1` overrides).
- **Do not raise `iogpu.wired_limit_mb`.** Unified memory is the constraint;
  giving the GPU more of it takes it from macOS.
- mlx-serve is told to plan around **16 GiB** of free RAM for macOS
  (`--os-reserve-gib 16`; its own default on a 128 GB Mac is 8). That is this
  repo's choice after the panic, not a measured optimum.

## What mlx-serve is

A native inference server for Apple silicon written in Zig on MLX, by David
Dalcu: <https://github.com/ddalcu/mlx-serve>, <https://mlxserve.com>. MIT
licensed; it bundles Apache-2.0 code listed in its `NOTICE` (including kernels
credited to MTPLX). It is **not** the unrelated Python package named
`mlx-serve` on PyPI (github.com/raspoli/mlx-serve). The model card links
mlxserve.com, and its `library_name` is `mlx-serve`.

What this combination relies on, from mlx-serve's `docs/cli.md`, `docs/api.md`,
`CHANGELOG.md` and source at commit `7c24003` (2026-09-23):

| | |
|---|---|
| Install | signed release tarball `mlx-serve-bin-macos-arm64.tar.gz` (binary + `lib/`), a Homebrew tap (`brew tap ddalcu/mlx-serve https://github.com/ddalcu/mlx-serve`), or the MLX-Serve app. Needs macOS 26.2+ |
| Serve | `mlx-serve --model <dir> --serve --host --port`; defaults `0.0.0.0:11234` |
| Endpoints | `/v1/chat/completions` (streaming), `/v1/models`, `/v1/completions`, `/v1/responses`, Anthropic `/v1/messages`, Ollama `/api/*`, `/health`, `/props`, `/metrics` (with `--metrics`) |
| Tool calls | yes: `tools` on chat/completions; the Qwen3.8 XML call format (`<tool_call><function=…><parameter=…>`) is parsed into `tool_calls` and arguments are schema-repaired (`--no-tool-autocorrect` turns that off). The model card: "Tools use Qwen3.8's XML call format; mlx-serve parses and schema-coerces it." |
| Thinking | per request `enable_thinking`, `reasoning_effort`, `reasoning_budget_tokens`; server-side only `--reasoning-budget`. Reasoning comes back as `reasoning_content` |
| Speculative decoding | the pack's native MTP head: `--mtp` (MoE models default off), per request `"enable_mtp": true`, `--mtp-depth`, `--max-mtp-ctx`. PLD is on by default; the card says PLD/DFlash are off for this model |
| Context / memory | `--ctx-size`, `--kv-quant off\|4\|8`, `--prefill-chunk` (default 8192), `--os-reserve-gib`, `--wired-margin-gib`, `--max-resident-mem`, `--max-concurrent` (default 1) |
| Prefix reuse | prefix cache on by default (`--prefix-cache-mem`, default 2 GB; optional SSD tier `--prefix-cache-disk`); `usage.prompt_tokens_details.cached_tokens` reports reuse |
| Version | `mlx-serve --version`, first line `mlx-serve <calver>` |

**Tool-calling verdict: supported**, per source and the model card, including
this model's XML format. Not yet observed by this repo. The installer's smoke
test sends a one-tool request and checks for a structured `tool_calls` entry;
if that fails, OpenCode, pi and the Vidi benchmark cannot work with it.

## The model

[`ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`](https://huggingface.co/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit),
pinned at revision `7eaef0fa82b4c3bf5c64cec60ace4bf48fd271e3`, converted by
David Dalcu (who also wrote mlx-serve) from
[Qwen/Qwen3.8-Flash-Next](https://huggingface.co/Qwen/Qwen3.8-Flash-Next) by
Qwen. Licence: **Qwen Community License 1.0** (in the repo's `LICENSE`):
permissive, but a "Model as a Service" or "AI Work Assistant" business needs a
separate licence from Qwen for commercial use, and products above 100M monthly
users or US$20M monthly revenue must display the model name. Read it before
building on it.

| | Source: the Hugging Face file list and `config.json` at the pinned revision |
|---|---|
| Size on disk | 107.33 GB (99.96 GiB): 100 shards 74.41 GB, vision tower 0.90 GB, `ngram_table.bin` 32.00 GB |
| Quantization | routed experts 4-bit group 64; attention, GDN, hyper-connections, indexer, shared experts, `lm_head` 8-bit group 64; `embed_tokens` 4-bit; n-gram table 4-bit group 32; routers, gates, norms bf16 (the card's table) |
| MTP head | included (`language_model.mtp.*` in the shards; `mtp_num_hidden_layers: 1`) |
| Vision | included, dense bf16 (`model-vision.safetensors`); this combination serves with `--no-vision` unless `VISION=1` |
| Architecture | `qwen4_exp`: 48 layers, 3 linear-attention (GDN) per full-attention layer, 512 experts, 10 active, 2 KV heads × 256 dims, sparse attention past 2048 tokens |
| Context | `max_position_embeddings: 262144` |
| Chat template | thinking on unless `enable_thinking` is false; `reasoning_effort` `xhigh` (default) / `medium` / `low`, anything else raises |
| Needs mlx-serve | ≥ 26.8.11 (first Flash-Next release, and the card's measurement); this combination pins **26.9.5** |

**The n-gram table.** The card: the 51B-parameter n-gram table is not in the
shards but in one 4-bit `ngram_table.bin`; "mlx-serve mmaps the file and, per
token, dequantizes the 16 rows it needs on the CPU … The table never becomes
resident: its cost is page cache, which the OS evicts as needed." It expects
decode speed unchanged and cold long prefills paying "up to ~1 s per 8k tokens"
of SSD reads. (MTPLX also streams its copy from SSD.) So the pack wants fast
internal storage.

**The author's numbers** (card, M4 Max 128 GB, mlx-serve 26.8.11 — not ours):
"~75 GB resident, decode ~60 tok/s serial and 78 tok/s with MTP (`--mtp`; +41%
on code, a few percent slower on prose), prefill ~730 tok/s". mlx-serve's
26.9.3 changelog reports this pack at 54.3 → 56.3 tok/s on an M4 Max.

## Memory: ESTIMATED

From the file sizes and `config.json`, vision off:

| Term | Arithmetic | 32k | 64k | 128k |
|---|---|---|---|---|
| Weights | 74,405,350,320 B of shards | 69.30 GiB | 69.30 | 69.30 |
| KV cache (bf16) | 12 full-attention layers × 2 heads × 256 × 2 B × K+V = 24,576 B/token, + MTP head 2,048 + indexer 768 = **27,392 B/token** | 0.84 | 1.67 | 3.34 |
| GDN state | 36 layers × 48 heads × 128 × 128 × 4 B, fixed | 0.11 | 0.11 | 0.11 |
| Prefix cache | mlx-serve's default cap | 2.00 | 2.00 | 2.00 |
| **Total** | | **72.2 GiB** | **73.1 GiB** | **74.7 GiB** |

Not included: the prefill working set (unmeasured; mlx-serve's changelog says
8192-token prefill steps cost "~3 GB more peak" than smaller ones), and the
n-gram table's page cache (evictable). `--kv-quant 8` roughly halves the KV
term; at these sizes it barely matters.

**Verdict for 128 GB:** on paper this fits under a ~96 GiB GPU budget with
~20 GiB to spare at 128k, a similar weight footprint to MTPLX's pack (measured
77.3 GB wired). But the same weights-plus-KV arithmetic would have predicted
~75 GiB for MTPLX at 115k, and it reached 97 GiB. Treat these as floors. What
this combination adds against that: one request and one resident model at a
time, a 16 GiB OS reserve inside mlx-serve's own memory planner (per its
changelog, long prompts that do not fit are refused up front since 26.8.11,
and queued rather than overrunning memory since 26.9.5),
and launcher refusals for co-resident servers and low free memory. It does
**not** fit alongside a running MTPLX Flash-Next: ~70 + ~72 GiB > 128.

## Thinking and effort — what actually happens

Read from mlx-serve's source, not observed:

- A request with neither `enable_thinking` nor `reasoning_effort` gets the
  architecture default, which for `qwen4_exp` is **thinking off**, unless the
  checkpoint's `generation_config.json` declares
  `default_chat_template_kwargs.enable_thinking` (this pack's does not).
  OpenCode sends neither field. So the launcher serves the pack through
  `~/.local/share/mlxserve-qwen38-flash-next/served/<model id>/`: symlinks to
  every file of the pack plus a `generation_config.json` that adds that one
  key, from `THINKING` (default 1). The pack itself is never modified. The
  directory's name is also the model id mlx-serve advertises.
- There is **no server-side reasoning effort**. A thinking request that names
  no effort renders as `low` with a 2048-token thinking budget (26.9.5). That
  matches the MTPLX sibling's default effort, but it cannot be raised
  server-side: `REASONING_EFFORT` accepts only `low`/`default`, and
  `REASONING_BUDGET=<n>` sets `--reasoning-budget`.
- This repo's pi config sets `supportsReasoningEffort: false`, so pi sends no
  effort either and gets the same `low`.

## Requirements

| Requirement | Why | Bypass |
|---|---|---|
| Apple silicon, macOS 26.2+ | mlx-serve's floor | none |
| ≥ 92,000 MiB GPU-addressable | ~70 GiB weights + context | `ALLOW_LOW_VRAM=1` (it will not fit) |
| ~108 GB free disk | the pack, all of it; checked before downloading | `MLXSERVE_MODEL_STORE=<bigger volume>` |
| `hf` CLI, `python3`, `curl` | download, verification | — |
| OpenCode or pi | the client | `npm install -g opencode-ai` |

## Install

```bash
./install-qwen-3.8-flash-next-macos-128GB-mlxserve-opencode.sh
# or: ./install.sh qwen/3.8/flash-next/macos/128GB/mlxserve-opencode
```

- **mlx-serve**: an installed `mlx-serve` ≥ 26.9.5 on `PATH` (or
  `MLXSERVE_BIN=`) is used as is. Otherwise the 26.9.5 release tarball is
  downloaded, checked against the sha256 GitHub publishes for it, and unpacked
  under `~/.local/share/awesome-local-ai/mlx-serve/v26.9.5/`. An older
  Homebrew install is left untouched.
- **Weights**: `hf download` at the pinned revision into
  `~/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit/`
  (mlx-serve's own store, so its app sees the same copy). Resumable; then
  every shard in the index, the n-gram table and the tokenizer/template files
  are checked, all 103 large files are sha256-verified against the Hugging
  Face LFS hashes, and a marker is written. Re-running with the marker valid
  makes no network call and re-hashes nothing.
- **Smoke test** (loads the model; skip with `SKIP_SMOKE_TEST=1`): waits for
  `/v1/models` to report `ready`, checks generation, reads MTP state from
  `/props`, checks that a repeated prompt reports `cached_tokens`, and sends a
  one-tool request expecting a structured `get_weather` call.

## Profiles

| Profile | ctx | MTP | KV | max tokens | need (ESTIMATED) |
|---|---|---|---|---|---|
| `agent` | 131072 | on | bf16 | 32768 | 76,538 MiB |
| `serial` | 131072 | off | bf16 | 32768 | 76,538 MiB |
| `lean` | 65536 | on | 8-bit | 32768 | 74,024 MiB |

`agent` is the default. The context ceiling copies the MTPLX sibling's
measured choice (it saw zero-token responses past ~200k there); nothing about
mlx-serve's behaviour at long context has been measured here.

The exact command line for `agent` (`PORT=8011`, defaults otherwise):

```
mlx-serve --model ~/.local/share/mlxserve-qwen38-flash-next/served/mlxserve-flash-next-mixed-4-8bit \
  --serve --host 127.0.0.1 --port 8011 --ctx-size 131072 --max-tokens 32768 \
  --kv-quant off --max-concurrent 1 --max-resident-models 1 --os-reserve-gib 16 \
  --mtp --no-vision --temp 1.0 --top-p 0.95 --top-k 20
```

`serial` swaps `--mtp` for `--no-mtp`; `lean` has `--ctx-size 65536 --kv-quant 8`.
`THINKING=0` swaps the sampler for `--temp 0.7 --top-p 0.80 --top-k 20`.

| Variable | Default | Meaning |
|---|---|---|
| `PROFILE` | `agent` | row above |
| `PORT` / `HOST` | `8011` / `127.0.0.1` | a non-loopback `HOST` requires `MLXSERVE_API_KEY` |
| `CTX`, `KV_QUANT`, `MTP` | profile | hand-sizing; turns the memory refusal into a warning |
| `THINKING` | `1` | server-side thinking default and the matching sampler |
| `REASONING_BUDGET` | unset | `--reasoning-budget` |
| `VISION` | `0` | `1` loads the vision tower |
| `OS_RESERVE_GIB` | `16` | `--os-reserve-gib` |
| `ALLOW_COEXIST`, `FORCE_LOW_MEM` | `0` | override the two refusals — read the top of this page first |

## Usage

```bash
./start.sh mlxserve --opencode      # or: mlxserve-qwen38-flash-next-opencode
./start.sh mlxserve --pi            # or: mlxserve-qwen38-flash-next-pi
mlxserve-qwen38-flash-next-server   # the server alone, foreground
```

By hand: `http://127.0.0.1:8011/v1`, model id
`mlxserve-flash-next-mixed-4-8bit`, any API key, client `limit.context`
**131072**.

The port opens before the model has loaded (`/health` answers at once). Wait
for `"state":"ready"` in `/v1/models` before trusting a client error.

## First run checklist

Only when nothing else is serving a large model (not during a Vidi run):

1. `mtplx stop` (or stop whatever else is serving); close heavy apps; check
   `memory_pressure` reports well above 60% free.
2. `./install-qwen-3.8-flash-next-macos-128GB-mlxserve-opencode.sh` — first
   `SKIP_SMOKE_TEST=1` if you want the ~107 GB download and hashing separate
   from the first model load.
3. Watch the smoke test: generation, MTP state, `cached_tokens`, and the tool
   call must all come back OK. A failed tool call means this cannot drive
   OpenCode or pi.
4. Record what the machine actually does: peak memory (`vm_stat`/Activity
   Monitor), swap, decode tok/s. Then replace the ESTIMATED rows in
   `profiles.tsv` with measured ones, and only then consider a Vidi run.

## What this combination installs

```
~/.local/share/mlxserve-qwen38-flash-next/
    install.env, profiles.tsv, help.txt, client*.sh
    served/mlxserve-flash-next-mixed-4-8bit/   symlinks + generation_config.json
~/.local/share/awesome-local-ai/mlx-serve/v26.9.5/   only if no suitable mlx-serve was installed
~/.local/bin/
    local-ai-mlxserve-server                   shared by mlx-serve combinations
    local-ai-session
    mlxserve-qwen38-flash-next-{server,opencode,pi}
~/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit/
```

Nothing installed contains your username; the runtime resolves everything
from `$HOME`.

## Credits

- Model: [Qwen](https://huggingface.co/Qwen) — Qwen3.8-Flash-Next, Qwen
  Community License 1.0.
- Pack and server: [David Dalcu](https://github.com/ddalcu) — the mlx-serve
  conversion and [mlx-serve](https://github.com/ddalcu/mlx-serve) (MIT).
