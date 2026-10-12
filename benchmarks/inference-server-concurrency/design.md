# The tool, as proposed (11 Oct 2026)

A general measurement tool for **any OpenAI-compatible inference server**: point it at an endpoint, give it a scenario, and it reports how many concurrent agents that server sustains. Nothing below is built. Everything is open to change; the decisions still needed are at the end.

## What it answers

> With this model, on this machine and engine, at this context size, what is the largest number of concurrent agents whose p90 turn latency stays within the limit, with no errors?

Reported per scenario and per context size, with the whole curve (N = 1, 2, 3 …) and the server's memory at each N. "Same model throughout" is an assumption of the tool: it records the model id, quantisation, engine version and launch flags it is told about, and refuses to compare runs that differ.

## Scenarios

| Id | Shape | Shared prefix | Mirrors |
|---|---|---|---|
| **A** | N separate sessions, each starting cold at about 10k tokens (a fresh pi or OpenCode agent: system prompt, tool definitions, first message), then agent-style turns until the target context | none | separate projects, any client |
| **A2** | one main session plus N fresh children, run in the foreground, in parallel, or in the background | the child agent type's system prompt and tools, about 10k | OpenCode, and the default modes of Claude Code and pi |
| **B** | one parent prefilled once to P tokens, then N children that each add a different task and carry on | the parent's whole context (50k to 150k) | Claude Code's fork; pi's `parent` mode |
| overlay | the extra calls a client makes on its own: a title near each session's start, a compaction near the window limit | none | OpenCode's hidden title, summary and compaction agents |

A **turn** is one agent step: an incremental prefill (median about 900 tokens in our traffic, p90 about 7,500), a generation (median 207 tokens, p90 966, with rare runaways to the 32,768 limit), and a think gap (median 0 s, p90 4 s for an autonomous agent). These are from [`strix-halo-observations-20261011.md`](strix-halo-observations-20261011.md) and should be refreshed from more traffic.

## What it measures

- **Client side, engine-neutral:** time to first token, inter-token time, tokens generated, errors and timeouts, per request and per agent. Time spent queueing is separated from time spent working wherever the engine reports it.
- **Prefix sharing (scenario B):** prefill tokens actually computed against N x P, first-child time to first token against the rest, and server memory growth per child.
- **Memory, from the machine:** GPU memory counters (`gpu_busy_percent` and the GTT/VRAM files on AMD, `nvidia-smi` on NVIDIA, `memory_pressure` on macOS), free and swap. Sampled at 1 Hz for the whole run.
- **Engine extras, optional adapters:** gufo's per-request fields (`plan`, `batch_width`, `queue_ms`, draft accepted and proposed), llama.cpp `timings`, vLLM and SGLang metrics. The tool works without them.

## The metric

The largest N for which, over the measured window, p90 turn latency is at most L and there were no errors, where L is set per run (candidate: **twice a solo turn**, so "two agents" means each is at most twice as slow). Also reported: aggregate tokens per second against N, and the N at which aggregate throughput stops rising.

## Prompts

Default to **synthetic, token-exact and unique per agent** (so no accidental cache hit), with a shared prefix only where the scenario says so. Reproducible and publishable. Optionally **replay recorded conversations** from the conversation warehouse for realistic token statistics; those are not publishable. The metering proxy (`benchmarks/spec-bench/harness/meter_proxy.py`) records one line of timing and usage per request but not the prompt text, so replay would rebuild prompts from the recorded conversations.

## Where things live

- `benchmarks/inference-server-concurrency/`: this folder (method, scenarios, published summaries).
- A Rust crate under `tools/` for the client (this repository builds in Rust unless there is a good reason not to). The existing `benchmarks/gufo-eval/throughput.py` is single-request and Python; it is the nearest ancestor.
- **Results go to the data root**, not to git, following `docs/designs/operational-data-separation.md`.

## Machines and engines for a first baseline

| Machine | Engines worth trying first |
|---|---|
| Strix Halo box | gufo (`--sessions N`), llama.cpp (`-np`) |
| M5 Max | mlx-serve (`--max-concurrent`) |
| RTX 4090 | llama.cpp (`-np`), SGLang or vLLM if they run our model |
| DGX Spark, if bought | llama.cpp (supports Flash-Next), then vLLM or SGLang (advertised for Flash-Next, not for the Spark) |

Runs that stop a machine's server (to restart with more sessions) need the owner's approval each time.

## Decisions still open

1. The latency limit L (candidate: twice a solo turn).
2. Context sizes (candidate: 64k and 128k, then 192k).
3. Prompts: synthetic by default, with replay later?
4. First engines (candidate: llama.cpp on the Spark, gufo and llama.cpp on the Strix Halo box).
5. Language (candidate: Rust).
6. Which client to mirror first (candidate: scenarios A and A2, then B, with the hidden-call overlay on any).

A Ceetrix story (PRD and design) should be written before any code.
