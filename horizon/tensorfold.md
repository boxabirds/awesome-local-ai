# TensorFold

**Status:** blocked on us (2 Oct 2026): checks 1 and 2 ran for real on the M5 Max. Check 1 passes, but only to 32k
tokens — short of our ~131k sessions — capped by the memory budget's own keep-prompt limit, not by the long-context
defect this note was originally about (that part looks fixed). Check 2 fails past the same ceiling. Two documented
levers to raise the ceiling were tried and neither worked, and a budget sweep that evening restarted the Mac. See
"What we found running the checks for real" below; nothing above 89.6 GiB runs here without the owner's say.
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
everything there and downloads nothing. Only one prepare runs at a time: started while another is still preparing
(the checks begun before `--prepare-only` has finished, say), the script exits 2 naming the other's PID; wait for it
and run again. On 1 Oct 2026 the download was left until the machine was free, and the
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

## What we found running the checks for real (2 Oct 2026)

Ran `tools/tensorfold-check/run-checks.sh` on the M5 Max for real, three times, each with the Mac free (held via
`dbench hold`) and the server stopped cleanly afterward each time. Evidence:
`~/.local/share/awesome-local-ai/tensorfold-check/runs/20261002T181207Z/` (89.6 GiB),
`.../20261002T182252Z/` (89.6 GiB + `--ple-on-ssd`), `.../20261002T182829Z/` (110 GiB + `--ple-on-ssd`).

1. **At the 89.6 GiB default: check 1 passes, capped at 32k.** All 9 turns up to 32,033 prompt tokens reused the
   previous prompt cleanly (worst re-read: 5 tokens, well inside the rule). The long-context cache-retention
   defect this note tracks (issue 71) does not reproduce in the range tested. But the check stops there because
   the budget's own keep-prompt limit is 48,128, and the check (by its own rule) never grows past
   `keep-prompt − 16,384`. Never reaches an out-of-memory condition, so never reaches the 100-125k range issue 71
   was actually about.
2. **Check 2 fails, but from the window, not from TensorFold mishandling a tool call.** Turn 12's recorded request
   needs 40,463 prompt + 8,192 reply = 48,655 tokens, 527 over the 48,128-token ceiling. The request is rejected
   before TensorFold gets to parse it. Not a finding about tool-call correctness either way.
3. **`TENSORFOLD_PLE_ON_SSD=1` (leaving the 29.8 GiB of n-gram tables on SSD instead of resident) made no measured
   difference at 89.6 GiB.** Identical 48,128 keep-prompt limit, identical check 2 failure at turn 12, byte for
   byte. TensorFold's own recipe doc says this machine class (128 GiB) already host-maps the n-gram tables by
   default, which would explain the flag being a no-op here — not independently confirmed beyond that.
4. **Raising `TENSORFOLD_MEMORY_LIMIT_GB` to 110 (TensorFold's own worked example for a 128 GiB Mac) made it
   worse.** Keep-prompt limit fell to 10,240, under a quarter of the 89.6 GiB figure. The request was clamped to
   107.5 GiB, the ceiling TensorFold reports for this Mac. Reverted; `config.sh` is back at 89.6 GiB.

### Why more budget gave a smaller window (read from the 0.6.0 source and the startup logs, evening of 2 Oct)

- The earlier guess here (n-gram tables becoming resident) was wrong: both budgets log "75.6 GiB resident, 29.8 GiB
  file-backed" and "77.2 GiB of weights kept resident".
- What changes is the prompt chunk. At 89.6 GiB the server logs "prompt chunks of up to 2,048 tokens"; at 107.5 GiB,
  "up to 8,192". `engine/prefill_step.py choose()` takes the largest chunk for which weights, the chunk's working
  memory and 131,072 tokens of cache fit the budget, counting one copy of the cache. The keep-prompt window
  (`server/prompt_memory.py largest_window(resumable=True)`) counts two copies plus the chunk's measured working
  memory, so the larger chunk passes the first test and then leaves little for the second.
- Probes at 107.5 GiB, startup only: `--prefill-pass 1` gives a 34,816-token keep-prompt window (10,240 without);
  an explicit `--context 163840` is refused: "the most one request can use is 18,176 tokens".
- `--prefill-pass 1` at 89.6 GiB changes nothing (48,128).
- 0.6.0 has no option to pin the chunk size; Flash-Next's choices are fixed in
  `families/qwen4_exp/__init__.py engine_settings()`.
- Estimate, not a measurement: with 2,048-token chunks, 9.4 GiB beside the weights keeps 48k tokens, so the 27 GiB
  free at about 105 GiB would keep roughly 130-140k.

### The M5 Max restarted during a budget sweep (2 Oct 2026, about 19:45 BST)

To find the largest budget that still uses 2,048-token chunks, TensorFold was started in turn at 94, 98, 102 and
105 GiB (startup only, no requests, machine held and otherwise idle). The Mac restarted during the sweep. The sweep's
output was in `/tmp` and was lost, so the budget that did it is not known, and no panic report was found in
`/Library/Logs/DiagnosticReports`. The earlier starts at 107.5 GiB had completed without trouble (memory free fell
to 18% while loading). With 77 GiB of weights resident, every route to a 128k window runs this Mac near its limit.

**Do not start TensorFold above 89.6 GiB on this Mac again without the owner's say.** Routes left: ask the
maintainer how a 128 GB Mac is meant to reach 128k with Flash-Next (the chunk choice above is the thing to show
them); `--ssd-experts`, which frees tens of GiB at 0.31-0.39x decode speed by TensorFold's own figures; or park it.

## 0.6.2 with TensorFold's own oQ4 checkpoint (2 Oct 2026, evening)

The pin moved to TensorFold 0.6.2 and `TensorFold/Qwen3.8-Flash-Next-MLX-oQ4-MTP` (every file sha256-verified), and
the checks ran once at the default 89.6 GiB budget. Nothing that matters changed:

| | 0.6.0, Vontra 4bit | 0.6.2, oQ4 |
|---|---|---|
| Weights kept resident | 77.2 GiB | 77.3 GiB |
| Prompt chunk | 2,048 | 2,048 |
| Keep-prompt context window | 48,128 | 47,104 |
| Check 1 (cache reuse, to 32,033 tokens) | pass, worst re-read 5 tokens | pass, worst re-read 5 tokens |
| Check 2 (pi's tool calls) | fails past the ceiling | fails at turn 11: HTTP 400, "needs about 86.7 GiB of the 86.6 GiB MLX may use" |

Loaded in 41.0 s; first reply 77.7 tok/s. The run's folder on the M5 Max is `tensorfold-check/runs/20261002T205205Z`.
The reports of this version and checkpoint working well that prompted the re-test were on a 256 GB machine. The
required minimum here is 128k tokens of context; on 128 GB this gives 36% of that. Not tested on 0.6.2: any budget
above 89.6 GiB (the owner's say is needed), so whether a larger budget still shrinks the window is not known for
this version. The draft issue in `issues/external/` describes 0.6.0 and has not been re-measured.

**Last checked:** 2 Oct 2026 (three real runs, eight startup probes and one crash on the M5 Max). **Next:** the
owner's choice among the routes above. Check 3 (and any real comparison run) stays blocked until checks 1 and 2
both pass in the 100k+ range.

Sources: [TensorFold](https://github.com/ashhart/TensorFold) ·
[API fields](https://github.com/ashhart/TensorFold/blob/main/docs/api.md) ·
[issue 71](https://github.com/ashhart/TensorFold/issues/71)
