# Concurrency: how many agents one model server carries

**Status:** open question (11 Oct 2026). Design and background written; nothing built or run. The owner wants a practical baseline of **concurrent subagents** per machine, with the same model throughout, in two cases: fresh unrelated agents (separate projects) and subagents forked from a parent's context.
**Where it could run:** the Strix Halo box, the M5 Max, the RTX 4090 machine, and one or two DGX Sparks if bought. It would be compared across machines and engines on the same scenarios.

All the material is in [`benchmarks/inference-server-concurrency/`](../benchmarks/inference-server-concurrency/README.md): the proposed general tool (`design.md`), what each engine's docs claim (`engines.md`), the per-session memory model for the 27B and Flash-Next (`memory-model.md`), how Claude Code, pi and OpenCode hand context to subagents (`subagent-context.md`), the Spark (`dgx-spark.md`) and 11 hours of a gufo server's log (`strix-halo-observations-20261011.md`).

## What is known

- On the Strix Halo box an agent that is working keeps the server about 62% busy, so two agents sharing it one request at a time each take about 1.4x as long (a simulation, not a measurement). A real concurrent decode (`--sessions N` in gufo, `-np` in llama.cpp) is unmeasured on our hardware.
- Each extra session costs its own KV cache: 24 KiB per token for Flash-Next (measured on gufo), so 4.5 GiB at 192k; two or three sessions is the ceiling on a 128 GB box.
- OpenCode's subagents start fresh and never fork the parent; Claude Code and pi (opt-in) can fork. Forks are where prefix sharing decides the cost.
- No source shows prefix-cache hits on Flash-Next's linear-attention layers, or MTP and prefix caching together under batching, on any engine.

## Checks before a run

- A Ceetrix story (PRD and design) for the tool; the owner's answers to the open decisions at the end of `design.md`.
- A quiet window on the machine under test: measuring concurrent sessions in gufo means restarting its server.
- A recorded OpenCode 2 stream and parser tests before any series on that client (see [`opencode-2.md`](opencode-2.md)).

## Confounds

MTP helps one stream and may cost under concurrency (llama.cpp config: 0.81 to 0.87x at 8 concurrent; vLLM's Qwen3.5 recipe: MTP-1 "degrades text throughput under high concurrency"), so a concurrency baseline needs MTP on and off. Snapshot and prefix caches fill with distinct conversations. A benchmark's own timing figures are not comparable with runs made while another agent shares the server.

**Last checked:** 11 Oct 2026. **Recheck when:** the owner has a Spark; a Flash-Next recipe lists consumer or Spark hardware; gufo, SGLang or vLLM document hybrid-model prefix sharing; OpenCode 2 changes its subagent defaults.
