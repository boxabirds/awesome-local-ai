# LightRSI and TokenPilot (a context manager for agents)

**Status:** parked (3 Oct 2026). Assessed from the paper, the repository and our own data; never run. Not a fit for
the baseline benchmark, as the analysis already suggested. One narrow question could bring it back (see the end).
**Kind:** not a stack and not an engine: an extension inside the client (pi, OpenCode) that changes what the agent
sends. If we ever ran it, it would be a new axis on an existing combination, never a change to a baseline.
**Sources:** the TokenPilot paper (arXiv 2606.17016, v2, accepted at EMNLP 2026), the LightRSI repository
(github.com/zjunlp/LightRSI, MIT) and its pi and OpenCode host pages, read 3 Oct 2026. Nothing here was measured.

## What it is

LightRSI is a runtime for "recursive improvement" loops in long-running agents. TokenPilot is its first preset and the
only one with results: a context manager that aims to cut the cost of a long agent session without breaking prompt
caching. It has two parts:

- **Ingestion-aware compaction.** At the start it makes the prompt prefix byte-identical from turn to turn (volatile
  values such as paths and timestamps replaced by placeholders; tool definitions moved downstream) and strips
  structural noise from tool output before it enters the history. Rule-based.
- **Lifecycle-aware eviction.** A second, small model (the paper uses Qwen3.5-35B-A3B, zero-shot) estimates when a
  segment of the conversation is no longer needed, and a conservative batch schedule drops those segments. Off by
  default in the adapters; it needs a model endpoint configured.

Its adapters for pi and OpenCode, which the owner contributed (pull requests 96 and 98, merged 2 and 3 Oct 2026), run
inside the client as an extension, with no proxy. The pi page says "verified on pi 0.87.1", our pin.

## What the paper shows

PinchBench (123 tasks; its own reference describes it as benchmarks for AI coding agents) and Claw-Eval (161 tasks), one
backbone for every method, GPT-5.4-mini over a provider API. Cost is dollars from the provider's own cache-hit and
cache-miss counts. TokenPilot reports 61% and 56% lower cost in isolated mode and 61% and 87% in continuous mode with
"competitive" scores (for example 81.3 on PinchBench continuous at $2.79). Ablations: stable placeholders alone take one
PinchBench baseline from $8.31 to $4.35 by turning cache misses into hits; rule-based pruning plus prefix
stabilization take another from $7.24 to $4.22. Its own limitations: prefix stabilization helps only where the backend
caches prefixes; the estimator can misjudge a segment; the thresholds may need tuning per setting; mixed task streams
may reuse less.

## The problems it solves, and the ones we have

| It is built for | What we measured | Fit |
|---|---|---|
| Dollar cost per token with provider cache discounts | We run local engines: no per-token price. The local cost of a cache miss is prefill time, and our engines cache prefixes | None. The metric it optimizes does not exist here |
| A volatile prefix that breaks the cache every turn | Prompt reuse within a session is high: gufo 0.5's one story reused about 96% on the requests sampled; Strata's synthetic 128k conversation reused all but the new tokens (127,962 of 128,001). Every story starts a fresh session, so nothing carries between stories | Low. The prefix is not shown to be unstable in our runs |
| Compaction that rewrites history and throws the cache away | pi compacts about every 114,000 prompt tokens; each takes 77 to 311 s and is 4 to 10% of Qwen story time (insight "compaction") | Real but small: this is the one place it could matter. Its eviction runs before pi's threshold compaction |
| Verbose tool output | Tool output is 38 to 63% of a conversation (M5 Max). pi's `read` tool is 50 to 60% of it. Reach analysis of RTK-style trimming: 18 to 30% of tool output reachable, 1% smaller on our agents' real commands | Same ceiling as RTK found; the agents already pipe most commands into `tail` or `grep` |
| (not a goal of the paper) | Our actual problems: the run-to-run effort variance (thinking, output tokens and calls move together, correlation 0.88 to 0.99 with time), tool-call parsing faults in engines, engine speed and long-context fit | None of these |

## Why it is not a fit for the baseline

- The benchmark measures a model, an engine and a machine under one fixed harness. A context manager alters what the
  agent sees, so it is a treatment, and it would confound the comparison it was added to.
- The strongest part of its claim rests on dollars and on provider cache metadata. Neither exists for a local server.
- Its eviction needs a second model to judge the conversation. Our machines each run one large model at a time (the
  mlx-serve, TensorFold and Strata launchers refuse a second model server), so that would mean the same engine
  serving both, which changes the run.
- Reduction hides tool output from the agent. Our own RTK analysis found the part it can reach is mostly searching and
  file views, where trimming risks hiding the line the agent needs.
- Nothing in the paper involves our workload: long builds of a web app over many stories on a local 27B or 125B model.

## Where it could run, and what it would be compared with

Wherever pi runs (verified by its authors on pi 0.87.1; OpenCode 1.18.33). Any stack's pi run is the comparison: the same
combination, same engine and model, with and without the extension.

## Confounds if it were ever run

It would change what the agent sees (reduced tool output, a moved prompt tail, a recovery tool the agent can call), the
prompt's byte layout, and, with eviction on, the model serving the run. Those are three effects, to be read separately:
reduction and stabilization are rule-based and need no second model; eviction does.

## What would bring it back

One experiment, on one stack, only if the compaction cost becomes the thing being chased: pi with the extension in
`conservative` mode, reduction on and eviction off (so no second model), against pi without it, five runs each, on the
stack where compaction costs most. A run takes 4h47m to 10h23m on the RTX 4090 machine (measured, Swift 1.5 baseline,
3 Oct 2026), so that is ten runs. The decision rule would be the RTK plan's (`docs/research/rtk/03-ab-test-plan.md`):
the held-out score must not fall, and story time must fall by more than the run-to-run spread. Recheck if: compaction
share of story time rises on a slower engine (a long Strata story at 128k is the case to watch); or the pi adapter
reports a measurable prefix instability in our logs; or the owner wants a client-side context-management combination
as its own line of results.

## Correction recorded here

An earlier answer in this session said we see "94 to 96% prompt reuse on gufo and Strata". The gufo figure is about
96% on the requests sampled in one story; the Strata figure is a synthetic test (nearly all tokens reused), not a
benchmark run. No Strata story has been recorded yet.

**Last checked:** 3 Oct 2026. **Recheck when:** a measurable compaction or prefix problem shows up in the recorded runs.
