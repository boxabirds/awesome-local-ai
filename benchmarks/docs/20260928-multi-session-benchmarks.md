# Multi-session benchmarks: ideas

*28 September 2026. Ideas only; nothing here is built or scheduled.*

Every benchmark in this repo so far runs one coding agent against one model server at a time. That answers "how good and how fast is this stack for one person at the keyboard". A different question is how a stack serves several agents at once, and it needs a different kind of benchmark.

## Where the idea came from

T.D. Inoue's article [Squeezing Extreme Performance Out of Qwen3.8-27B](https://tedsan.substack.com/p/squeezing-extreme-performance-out) reports a DGX Spark running Qwen3.8-27B for 15 to 17 coding agents at once, producing about 240 tokens per second between them. The setup was SGLang, NVFP4 weights, an FP8 conversation cache, DFlash2 speculative decoding, prefix caching and a thinking cap of 8,192 tokens per turn.

The comments on the article fill in the rest:

- The 240 is a total across all the agents. Each agent got 10–15 tokens per second under full load. In the author's words, that is "no good for interactive use. Fine for bots."
- One agent on its own got 47 tokens per second with Qwen3.8-27B, and 118 with Qwen3.6 MoE.
- About 2,900 prompt tokens per second went through the server, and 96% of them were cache hits.

So this is a different workload with a different goal: total throughput across many agents, not speed for one person. For interactive work I want 40 tokens per second or more per agent, which that setup doesn't give under load.

## What changes when several agents share a server

**Batching raises total output, not per-agent speed.** Generating text on these machines is limited by memory speed: each token means reading the model's weights once. With 16 conversations in flight, one read serves 16 tokens, so the total goes up roughly with the number of conversations while each conversation stays about as slow as before, or gets slower. Batching helps mixture-of-experts models less than dense ones, because different conversations use different experts and each extra conversation adds more weights to read. In the article, Qwen3.6 MoE went from 118 tokens per second alone to about 360 in total (about 3 times), while the dense 27B went from 47 to 240 (about 5 times).

**Most cache hits come from each agent's own conversation, not from sharing.** Every agent turn re-sends the whole conversation plus a small new tail, so each turn finds 95–99% of itself already in the cache. The single-agent runs here already get this: a typical mlx-serve request reads 40,113 of 40,377 tokens from cache, and gufo reused its cache on 222 of 227 requests in one story. A 96% hit rate across many agents is mostly that effect, repeated per agent.

Agents can only share an identical beginning of the conversation, token for token: the system prompt and the tool definitions, a few thousand tokens. Two agents on the same codebase share little more than two agents on different ones, because they read files in different orders at different times and their conversations diverge early.

**Memory, not cache sharing, is the real constraint.** Each agent needs its own conversation cache. If they don't all fit, the server evicts some, and an evicted agent has to re-read its whole conversation from scratch. On a machine with slow prompt reading that is a long stall: about 10 minutes for a 100,000-token conversation with llama.cpp on the Strix Halo, and about a minute and a half with gufo. Flash-Next should be friendlier to several agents than a conventional model of its size, since most of its layers keep a fixed-size state instead of one that grows with every token, but that isn't measured.

## Two different benchmarks

**1. Several independent agents, each on its own project.** This tests the inference stack. It's the benchmark runs we already do, run side by side on one server. It would also get the three runs per stack done sooner.

What to measure:

- tokens per second per agent, and in total;
- how often a conversation is evicted and re-read, and how long each re-read takes;
- scores against the same stack run one agent at a time, since slower agents hit the story time caps more often and that could change results;
- memory headroom and swap.

Candidate machines and settings:

- The M5 Max (128 GB): mlx-serve's `--max-concurrent` (default 1). The Flash-Next model uses about 77 GB, so two agents might fit, especially with `--kv-quant 8`, which roughly halves the conversation cache. Its prefix cache defaults to 2 GB (`--prefix-cache-mem`), and the logs already show it evicting entries with one agent.
- The Strix Halo box (128 GB): gufo's `--sessions` (currently 1). gufo's experiment log tests 2 to 8 batched sessions. Memory is tight: one session at 131,072 tokens of context already uses about 88 GB.
- The RTX 4090 machine: 24 GB leaves little room for a second conversation cache with Qwen3.8-27B.

**2. Several agents changing the same codebase.** This tests coordination rather than inference: merge conflicts, agents undoing each other's work, and how the harness divides the work between them. It's a real question, but it's about agents and harnesses, and it's much bigger to build. The cache argument above means it wouldn't make the inference side faster.

## Techniques from the article and whether they transfer

| Technique | Strix Halo | M5 Max |
|---|---|---|
| Several agents at once (batching) | gufo supports it; memory is the limit | mlx-serve supports it |
| Prefix caching | llama.cpp can reuse a cached prompt; gufo keeps session snapshots | on by default, 2 GB cap |
| Speculative decoding | MTP, already in use | depends on the engine |
| 4-bit (FP4) weights | no hardware support | no hardware support |
| Thinking cap of 8,192 tokens | not needed: see below | not needed: see below |

On the thinking cap: in canvas-mlx-02 (uncapped, 1,857 requests) only 15 turns (0.8%) produced more than 8,192 tokens of output, and cutting them there would have saved about 5% of generation time. An 8k cap would change little for these runs.

## Open questions

- How many Flash-Next conversations fit on the M5 Max and on the Strix Halo box before evictions start?
- How far does per-agent speed drop with two agents, and does that change scores through the time caps?
- Is the per-agent speed under load still usable for interactive work (40 tokens per second or more), or is multi-session only for unattended agents?

## Sources

- The article and its 13 comments, read on 28 September 2026.
- Cache reuse figures: the mlx-serve server log of canvas-mlx-02 on the M5 Max, and the [gufo long-session investigation](../../docs/20260928-gufo-long-session-investigation.md).
- Thinking-cap figures: output tokens per request in canvas-mlx-02's server log.
- mlx-serve options: the [mlxserve-pi README](../../combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/README.md).
