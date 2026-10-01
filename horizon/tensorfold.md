# TensorFold

**Status:** unblocked upstream, not yet by us (1 Oct 2026): the long-context defect has a named fix in 0.3.6.3, confirmed by its reporter. Our own long-context check (below) still has to pass before any run.
**Machine:** the M5 Max (128 GB, MLX). Compared with mlx-serve on the same model.

## What it is

An OpenAI-compatible server (Apache-2.0 from 0.6.0, MIT before) for Apple Silicon (MLX) and NVIDIA (CUDA), no AMD, built around exact
speculative decoding: a drafted token is kept only if it equals what the same engine would produce serially.
Draft sources: MTP heads, the DFlash2 draft model, and copies of the context. Version 0.6.0 on 30 Sep 2026, very active.
Supports Qwen3.8 Flash-Next (`Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP`) on MLX with its MTP head, and on MLX
tool calls, streaming and `reasoning_effort`.

## The long-context defect, and its fix

TensorFold issue 71: on 0.3.5.1 with Qwen3.8-27B and DFlash2 on a 64 GB M5 Pro, prompts past about 100-125k tokens
were served but their cache checkpoint was not kept, so every later turn re-read the whole context (7-11 minutes
per turn). Our agent sessions run to about 131k tokens, so the owner ruled it a blocker (29 Sep 2026).

Fixed in **0.3.6.3** (29 Sep 2026). The maintainer named two faults: the DFlash2 head kept every prompt chunk's
hidden states alive until the first draft (114 KB a token, now 64 KB), and a resumed turn held the prefix it
resumed from until its prefill ended, so making room for its own checkpoint evicted every conversation. The
reporter re-ran the same fixture on the same Mac with stock settings and confirmed it fixed. The server now says
at startup how many tokens a request can use and still keep its prompt for the next turn (139,264 on that 64 GB
Mac with the 27B).

Still open on the issue: on a 96 GB M3 Ultra a conversation grown to about 191k tokens lost part of its cache when
checkpoints were rotated to disk (480-503 s to first token). That is past our 131k, on a different model and
machine; our check below covers our own case.

## What has changed since 29 Sep (0.3.6.3 to 0.6.0, six releases in three days)

- **0.4.0:** Flash-Next's mixed and 2-8-bit checkpoints load on Macs, each module in its own format. The mixed
  4/8-bit weights mlx-serve runs may therefore load in TensorFold, which would remove the weights confound below
  (untested by us).
- **0.5.0:** the CUDA server takes `reasoning_effort`, `min_p` and typed tool arguments, as the Mac server does:
  the two CUDA caveats below no longer hold, by its release notes.
- **0.6.0:** CUDA runs on RTX 40 cards, so the RTX 4090 machine becomes a second candidate; tool-call arguments
  stream as written; a prompt past the context window gets `context_length_exceeded`; the licence is now
  Apache-2.0 (was MIT).
- **Activity (1 Oct 2026):** 770 stars, 99 forks, 38 open issues; the repository was created on 19 June 2026.

## Checks before a run

1. On the M5 Max, with the exact config we'd benchmark (TensorFold version, model, draft method, context
   limit; 0.3.6.3 or later): a multi-turn conversation grown past 120k tokens where every turn reuses the cache (only new
   tokens prefilled; check the server's cached-token count and prefill time).
2. Tool calls over `/v1/chat/completions` with pi's real requests.
3. Then a one-story smoke test.

## Confounds

Vontra's 4-bit weights vs mlx-serve's Dalcu mixed 4/8-bit: use the same weights for both engines if
TensorFold reads them (0.4.0 says it loads mixed checkpoints: check), otherwise note it. Checked against the
0.6.0 source (1 Oct 2026): it cannot read the Dalcu pack (see "Which weights" below), so the comparison is not
same-weights. On CUDA, 0.5.0 says `reasoning_effort` and typed tool arguments now work; before that they didn't.

## How to run the checks

Prepared, not yet run (1 Oct 2026). The script works in two phases, and the first doesn't need the machine to be
free.

**As soon as the checks are planned, while the M5 Max is still benchmarking,** from the repo checkout:

```
tools/tensorfold-check/run-checks.sh --prepare-only
```

This installs TensorFold 0.6.0 at its exact commit into its own venv, fetches the pinned checkpoint (113 GB; it
checks the disk first, and resumes if interrupted) and renders a recorded pi session into the requests pi sends. It
uses disk and network only: it starts no model server, loads no weights and binds no bench port, so it is not held
back by a running benchmark. It exits 0 once everything is in place and 2 if something failed. Run again, it finds
everything there and downloads nothing. On 1 Oct 2026 the download was left until the machine was free, and the
machine then sat idle for two hours waiting for it.

**Once the current run has ended and before another is queued** (hold the dbench node, or leave nothing queued):

```
tools/tensorfold-check/run-checks.sh
```

It prepares again (nothing to do if `--prepare-only` finished), then starts the server as the combination will, runs
checks 1 and 2, stops the server by its PID and prints PASS or FAIL for each with the evidence files. When both pass
it also prints the one-story `dbench submit` for check 3. The checks themselves are refused while the Mac is busy (a
`drive.py` agent run, a running dbench job, a queued job on a node that isn't held, or a model server already
resident; `--even-if-busy` overrides): on a busy Mac the script still prepares, then exits 3 saying the checks are
waiting for the machine. Everything lands in `~/.local/share/awesome-local-ai/tensorfold-check/runs/<UTC time>/`.
Re-running is safe: the install and the weights are reused.

**Which weights.** TensorFold can't load mlx-serve's pack (`ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit`): the
pack keeps its n-gram tables in a separate `ngram_table.bin`, mlx-serve's own layout, and TensorFold reads them only
as tensors inside the safetensors. The checks and the combination use the checkpoint TensorFold names,
`Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP` at `dadefa80`. So any comparison with mlx-serve compares engine and
quantisation together.

**The server.** `tensorfold serve <checkpoint> --name … --reasoning-effort low --max-tokens 32768 --parallel 1
--snapshot-dir none --temperature 1.0 --top-p 0.95 --top-k 20` with TensorFold's default memory budget, 89.6 GiB (70% of RAM; this Mac
kernel-panicked on 24 Sep, so the checks start conservative), and no `--context`. Without `--context`, TensorFold fits the window to "the most one request can use … and
still keep its prompt for the next turn" and prints that number at startup. This is the keep-prompt limit.

**Check 1, long-context cache retention.** It replays one recorded mlx-serve session (v2-r2 story 10, 652 turns) as
a single conversation that never compacts, one turn at a time, using pi's exact request bodies. Only the model name
changes, and the reply limit drops to 64 tokens because the check measures prefill. The conversation grows to 135,000
prompt tokens, or to the keep-prompt limit less 16,384 if that is lower. Every turn records prompt tokens, cached
tokens, new tokens, time to first token and prefill tok/s. The check passes only if every turn after the first meets
two conditions:

- `cached >= previous prompt - 512`. TensorFold resumes at assistant-message boundaries, skipping any closer than
  256 tokens, so a healthy turn re-reads a few hundred tokens at most. Issue 71 re-read everything.
- `time to first token <= 5 s + 4 x new tokens / turn 1's cold prefill rate`. The time tracks the new tokens, not
  the whole context.

A failure names the first turn that broke a rule. The check then runs two more turns and stops.

**Check 2, tool calls.** It sends 8 recorded turns where pi had just returned a tool result, each twice (plain and
streamed) with a fixed seed. The check fails on any of the following:

- a tool call returned as `<tool_call>` text (gufo issue 304's shape)
- arguments that aren't a JSON object, or a value of the wrong type for pi's schema, such as a stringified number
- streamed deltas that assemble to a different call
- fewer than half the samples making a structured call
- `reasoning_effort` low or high refused, or high not reasoning longer than low

**pi's context limit.** pi reserves 32,768 reply tokens per request (TensorFold holds them out of the window) and
compacts at `CONTEXT_LIMIT - 16384`, so `CONTEXT_LIMIT` must be at most keep-prompt limit - 16,384, and at most 131,072
to match the mlx-serve runs. The driver prints whether the combination's value fits, or the value to set.

**Check 3** needs two staged files moved into place first (owner's approval): `lib/runtime/server-tensorfold.sh`
and the root `install-qwen-3.8-flash-next-macos-128GB-tensorfold-pi.sh`, both in `tools/tensorfold-check/staged/`.

Tests, all against fakes with no network: `uv run --no-project --with pytest python -m pytest tools/tensorfold-check/tests`,
`bash tools/tensorfold-check/tests/driver-test.sh` and `bash tests/tensorfold-test.sh`.

**Last checked:** 1 Oct 2026 (releases to 0.6.0, issue 71 and its comments). **Next:** our long-context check on the M5 Max when it is free between mlx-serve runs (needs the owner's go-ahead).

Sources: [TensorFold](https://github.com/ashhart/TensorFold) ·
[API fields](https://github.com/ashhart/TensorFold/blob/main/docs/api.md) ·
[issue 71](https://github.com/ashhart/TensorFold/issues/71)
