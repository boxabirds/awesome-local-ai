# Inference-server concurrency

**Status: design and background only (11 Oct 2026). No tool has been built and nothing here has been run on a Spark.** This folder holds what we learned while asking one question: *how many agents can one model server carry at once, on each machine we own or may buy?*

The unit that matters is **sustained concurrent agents**: the largest N for which every agent's turns stay within a stated latency limit and nothing fails, with the same model throughout. It is asked two ways, because the two have different physics:

| Case | What the N agents share | What it costs per agent |
|---|---|---|
| **Fresh agents** (separate projects, or fresh subagents) | nothing, or a small system-prompt and tool-definition prefix (about 10k tokens in our traffic) | its own full-attention KV cache, recurrent state and snapshots, growing with its own context |
| **Forked subagents** (a child that starts from the parent's whole conversation) | the parent's prefix, which can be 50k to 150k tokens | prefill is saved, but in gufo (per its docs) a restored prefix is a *copy*, so memory still grows per child; the other engines do not say |

## Contents

| File | What it holds |
|---|---|
| [`design.md`](design.md) | the proposed general tool: scenarios, the metric, outputs, where data goes, open decisions |
| [`engines.md`](engines.md) | what each engine's own docs advertise about concurrent decoding, prefix sharing, hybrid (Gated DeltaNet) models and speculative decoding, with quotes |
| [`memory-model.md`](memory-model.md) | which parts of a session are shared and which grow per session, for the dense 27B and for Flash-Next, with the numbers we have |
| [`subagent-context.md`](subagent-context.md) | how Claude Code, pi, OpenCode 1.x and OpenCode 2 hand context to subagents, and how many they run at once |
| [`dgx-spark.md`](dgx-spark.md) | what a DGX Spark (one or two) would add, from NVIDIA's pages and third-party measurements |
| [`tritus-observations-20261011.md`](tritus-observations-20261011.md) | what 11 hours of a gufo server's own log say: how busy it was, how requests queued, draft depth, cold starts, and a simulation of N agents sharing it |
| [`scripts/analyse_gufo_log.py`](scripts/analyse_gufo_log.py) | the exploratory script that produced those figures (it is not the future tool) |

## How to read the numbers

Each number says where it came from: **advertised** (a project's own docs or a vendor), **measured** (by a third party, or by us on our machines), **derived** (arithmetic on the above) or **assumed**. Claims we could not confirm say so. The bits we are least sure of are listed at the end of `engines.md` and `dgx-spark.md`.

## Not yet decided

See the end of [`design.md`](design.md). In short: the latency limit that defines "within", which context sizes, synthetic or replayed prompts, which engines first, and the build language (Rust is the default in this repository).

Results of any future run are operational data: they belong in the data root, not in git (see `docs/designs/operational-data-separation.md`). Only summaries and method belong here.

Related: [`horizon/concurrency.md`](../../horizon/concurrency.md) (the open question, with what to watch), [`docs/research/20260918-bonsai2-concurrent-sessions.md`](../../docs/research/20260918-bonsai2-concurrent-sessions.md) (an earlier estimate for llama.cpp slots; its two named assumptions were never measured).
