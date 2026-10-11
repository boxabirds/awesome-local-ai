# What each engine's own docs say about concurrency (read 11 Oct 2026)

Quotes are from each project's own pages. **Advertised** means a project's claim; **measured** means ours or a third party's. Where the docs say nothing, the cell says *not found in its docs*; where a line is my inference it says so. Nothing here was run.

## Summary

| Engine (where we run it) | Concurrent decoding | Shared prefix across concurrent requests | Hybrid (Gated DeltaNet) model stated |
|---|---|---|---|
| gufo (Strix Halo) | Yes: `--sessions N`, "scheduler batches ready requests" | Yes, by copy and restore | Yes: Flash-Next snapshots hold the recurrent state |
| llama.cpp (all machines) | Yes: `-np`, continuous batching | Prompt reuse per slot; no claim that concurrent slots hold one physical copy | Not stated; our config relies on context checkpoints |
| mlx-serve (M5 Max) | Yes: `--max-concurrent` (default 1) | Prefix cache; concurrent requests not stated | Partly: memory cap for hybrids; FAQ advises turning the cache off for byte-stable output |
| SGLang (3090 config) | Yes: `--max-running-requests` | Yes: RadixAttention, session radix cache | Yes: Mamba radix cache; the branching-point mode is NVIDIA-only |
| vLLM (HyperQwen is built on it) | Yes: `max_num_seqs` | Yes: automatic prefix caching | Partly: opt-in `--mamba-cache-mode align`; two of its pages disagree on status |
| Strata | Opt-in: `parallel`, 4 to 8 slots | Not stated (state is copied into each slot) | Not stated beyond per-slot GDN state |
| MTPLX | Default `serial`; a batch lane is documented for Qwen3.6 35B only | Not stated (a per-session bank) | Not stated for Flash-Next |
| TensorFold | Docs conflict on Flash-Next | Not stated for concurrent requests | Not stated |

## gufo (`github.com/gufo-org/gufo`, `docs/SERVER.md`, `docs/KV-CACHE.md`)

- **Sessions:** "`--sessions N` controls the bounded execution session pool... The scheduler batches ready requests when the model runner supports their execution mode." Default 1. "Draft and verification work can batch across ready requests" (Flash-Next MTP). `usage.gufo` reports "logical concurrency; physical execution width; and the executed plan". The log names `plan=serial-c1` and `batch_width=1`; the docs do not describe those names.
- **Shared prefix:** `KV-CACHE.md` has a section "Concurrent requests sharing a prefix": a cold request that shares a long prefix with a request already prefilling it waits for that one; the leader publishes a checkpoint and the follower restores it. It "waits at most once, and at most `--sessions - 1` requests wait". "With `--sessions 1` nothing waits". The docs say reuse "costs a copy", so a restored prefix is duplicated per session. "Forks copy the live prefix directly between device buffers."
- **Memory per session:** "`--sessions N` allocates N mutable execution states", each with "independent KV, recurrent, graph, activation, and logit state". "Reduce `--context` or `--sessions` if their state exceeds available memory." `--cache-ram-bytes` defaults to 0 (automatic, "capped at 32 GiB and half the available host RAM"); 128 checkpoint records, independent of sessions; `--cache-disk` is opt-in, 8 GiB by default.
- **Hybrid:** snapshots are opaque: "For Qwen3.8-Flash-Next it also contains GDN recurrent state... a saved snapshot can only be reused whole, and only when its tokens are an exact prefix of the new prompt". Checkpoints are taken on a 2,048-token grid plus "learned divergence points".
- **Speculative decoding:** "MTP draft length adapts within the configured ceiling." Whether batching hurts MTP: *not found in its docs*.

## llama.cpp (`tools/server/README.md`)

- **Advertised:** "Parallel decoding with multi-user support", "Continuous batching". `-np`: "number of server slots (default: -1, -1 = auto)". `-kvu`: "use single unified KV buffer shared across all sequences (default: enabled if number of slots is auto)". `--kv-unified-per-slot N`: "the shared KV pool is sized to n_parallel*N".
- **Prefix:** `cache_prompt`: "Re-use KV cache from a previous request if possible... the common prefix does not have to be re-processed". `-sps`: "how much the prompt of a request must match the prompt of a slot in order to use that slot (default: 0.10)". `--cache-reuse N`, `-cram` (default 8192 MiB), `--cache-idle-slots`. The docs never say two concurrent slots keep one physical copy of a shared prefix: *not found in its docs* (the pool sharing is my inference).
- **Hybrid:** `-ctxcp`: "max number of context checkpoints to create per slot (default: 32)". Nothing names hybrid or recurrent models. Our own `llamacpp-pi/config.sh` says the Gated DeltaNet layers cannot roll back, so without checkpoints a returning turn re-reads its whole prompt.
- **MTP and batching:** `--spec-type` lists `draft-mtp`; the docs do not say how it behaves with several slots. Our `config.sh` comment says MTP "was measured a net loss (0.81-0.87x) at 8 concurrent" (source not named).

## SGLang (`github.com/sgl-project/sglang`, docs under `docs/docs/advanced_features/`)

- `--max-running-requests`, `--chunked-prefill-size`. `--disable-radix-cache`: "Disable RadixAttention for prefix caching". A session radix cache "registers reusable KV to a session". That a shared prefix is stored once is implied by a radix tree but I found no sentence saying so.
- **Hybrid:** `Qwen3.6.mdx` §3.2: "Qwen3.6's hybrid Gated Delta Networks architecture supports two mamba scheduling strategies". V1 `no_buffer` (default): "No overlap scheduler"; "Branching point caching support is feasible but not implemented". V2 `extra_buffer`: "overlap scheduling and branching point caching... Requires FLA kernel backend (NVIDIA GPUs only)".
- **Memory:** `--max-mamba-cache-size`; `--mamba-full-memory-ratio` (default 0.9); `extra_buffer`: "mamba state usage per running req becomes `2x` for non-spec; `1+(1/(2+speculative_num_draft_tokens))x` for spec dec". Our `sglang-opencode` config for the 3090 sets `--max-running-requests 1 --max-mamba-cache-size 5`.
- **Speculative:** compatible with EAGLE, NGRAM, DSPARK and DFLASH in the `extra_buffer_lazy` mode; MTP with large batches: *not found in its docs*.

## vLLM (`github.com/vllm-project/vllm`, `docs/`)

- `max_num_seqs` bounds the batch; "Chunked prefill is enabled by default whenever possible". `features/automatic_prefix_caching.md`: "a new query can directly reuse the KV cache if it shares the same prefix with one of the existing queries".
- **Hybrid:** `design/hybrid_kv_cache_manager.md`: "The prefix caching support of the mamba model is work in progress." The newer automatic-prefix-caching page: "Under `--mamba-cache-mode align`, Mamba state is stored only on the Mamba block grid, so a prefix-cache hit can resume only at a block boundary." `--enable-mamba-shared-prefix-checkpoint` is "off by default". The two pages disagree on status; I did not check which is newer.
- **Qwen3.5 recipe** (`docs.vllm.ai/projects/recipes/en/latest/Qwen/Qwen3.5.html`): "Prefix caching for Mamba cache 'align' mode is currently experimental." "MTP-1 reduces per-token latency but degrades text throughput under high concurrency." "For latency-sensitive workloads at low concurrency, enable MTP-1 speculative decoding and disable prefix caching."
- HyperQwen (vLLM 0.30.0 with patches, dense Qwen3.8-27B on one 24 GB card): batch mode "~1,035 tok/s aggregate at 64 concurrent"; "Speculation wins below ~8 concurrent users, plain batching above"; "Every resident request reserves 1+k = 8 recurrent-state slots — 15.8% of the 69,758-token pool" for DFlash2, against 8.2% for MTP k=4; `PREFIX_CACHE=1` is "vLLM's hybrid prefix caching (`--enable-prefix-caching --mamba-cache-mode align`), which upstream keeps opt-in for hybrid models".

## mlx-serve (`github.com/ddalcu/mlx-serve`)

- `--max-concurrent N`, default 1: "Continuous-batch decode parallelism". `performance.md`: "~1.6× *total* throughput at 4-way on dense models". `--prefix-cache-entries N`: "Shared-prefix KV cache entry cap".
- **Hybrid:** `--prefix-cache-mem` is "`2 GB`, or one session at the working context on hybrid (Qwen3.5+...)". The FAQ: "on hybrid architectures (Qwen 3.5/3.6/3.8...): `--prefix-cache-entries 0`, since a cache hit re-runs the recurrence in a different block size" (advice for byte-stable output). `gotchas/engine-mlx.md`: the hybrid cache "retains far more than it reports" (about 3.4x under-count). MTP is batched across "four MTP slots" in a changelog-style entry.

## MTPLX (`github.com/youssofal/MTPLX`, `docs/concurrency.md`)

- `--scheduler-mode`: `serial` ("the default"), `cooperative`, `ar_batch`, `mtp_batch`, `mtp_cohort_experimental`, `hyper` ("not a concurrency mode: external admission is fixed at 1"). The only documented batch lane is Qwen3.6 35B A3B at batch 8. Our run used `serial`. Each request owns "logical KV and recurrent state". Our measurement: about 75 KB per token against the plan's 32 KB (`docs/20260924-mtplx-memory-report.md`).

## TensorFold (`github.com/ashhart/TensorFold`)

- `--parallel N`: "Admit up to N requests where the engine shares lanes; `auto` is the default." README: "Flash Next runs one active reply per engine". `docs/api.md` conflicts: "An explicit `--parallel N` above one shares rounds for Qwen3.8-27B... and for Flash Next and Qwen3.6 on one rank." Which holds on a Mac is unclear.

## Strata (`github.com/Niko1221/Strata`, `docs/BATCHING.md`)

- "By default Strata serves one request at a time". `"parallel": N` / `--batch N` decodes them together, "at most 8 slots by card, 4 from 32 GB", with a warned cost of "about 10-25% speed per request on this card". Each slot "gets its own state (a session carved like the stage's own: GDN recurrence, QSA K/V and indexer, PLE history)". "Each admission reads the request's prompt through the usual prompt path... the state is then copied into the slot." Slots decode without MTP by default; `--batch-mtp` is opt-in, +15.4% on 2x RTX 3080 and -21.9% on 2x R9700.

## Others noted

- **Rapid-MLX** (`github.com/raullenchai/Rapid-MLX`): "Continuous batching"; "Radix prefix cache in memory (with state snapshots for hybrid models)". Apple hardware only; see `horizon/rapid-mlx.md`.

## The claims we are least sure of

1. That SGLang stores a shared prefix once (inferred from RadixAttention).
2. That llama.cpp's unified buffer stores a shared prefix once between slots, and how it treats hybrid models: not in the README; the linked pull requests (#15293, #16391) were not read.
3. TensorFold on Flash-Next (two pages disagree), and which of vLLM's two hybrid pages is newer.
