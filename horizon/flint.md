# Flint (Recursive)

**Status:** candidate (22 Oct 2026). Added at the owner's request. Nothing downloaded or run. About a day old when read.
**Kind:** a new model family, and it ships its own "local engine", so model and engine move together unless we serve it with SGLang or vLLM.
**Where it could run:** the Sparks (SGLang's cookbook lists DGX Spark), the M5 Max and the Strix Halo box (small enough: LM Studio says about 24 GB), and possibly the 4090 machine (24 GB is the whole card, so tight). Not checked on any of them.

## What it is

Open-weight coding MoE from Recursive (Recursive SI), Apache 2.0, "trained for local agentic coding". Read from the [model card](https://huggingface.co/RecursiveSI/flint) and the [SGLang cookbook](https://docs.sglang.io/cookbook/autoregressive/Recursive/Flint).

- **39.8B total, about 2.5B active** (2.2B body plus output head). 49 layers (2 dense, 47 MoE), 256 routed experts, 6 chosen per token plus a shared expert. 35 sliding-window layers (513-token window) and 14 full-attention layers. 262,144 tokens documented.
- **Variants:** 12 quantised models on the Hub for llama.cpp, Ollama, LM Studio, Jan; the card gives no sizes. Not MLX per the card.
- **Serving:** SGLang image `lmsysorg/sglang:dev-flint` with `--reasoning-parser flint` and `--tool-call-parser flint` (a Flint-specific tool-call format, so our checks apply). vLLM and Docker Model Runner also documented. The card's SGLang kit says one B300 or H200 per replica; the cookbook lists DGX Spark among hardware. Recursive's own engine is at `recursive-oss/rec`, licence not stated in what was read.
- **Sampling:** temperature 1.0, top-p 0.95, top-k 20 (the same as our standard sampler); at least 32,768 output tokens for hard problems.
- Launch partners: OpenHands, LM Studio.

## Whose figures

All Recursive's: Terminal-Bench 2.1 54.9%, SWE-bench Pro v2 89.7%, SWE-bench Verified 74.2%; comparison rows are "developer-reported". Speed claims: 125+ tok/s on a MacBook Pro (an M4 Pro per one write-up), 150+ on "RTX Spark" (their term; whether that is the GB10 Spark is **not stated**). No independent benchmark found. Sources differ on context (262K vs up to 512K).

## Checks before a run

1. **Pick an engine per machine and pin it** (SGLang image tag on Sparks; the Recursive engine or llama.cpp elsewhere). Confirm it runs on **aarch64/sm_121** before counting on a Spark: the card does not mention it.
2. **Tool calls over the API** with the Flint parser: structured `tool_calls`, arguments that parse, a newline in a string argument kept.
3. **Reasoning output:** `reasoning_content` is separate with the Flint reasoning parser; check what our harness and analytics (`think_complete`) read.
4. **Prefix reuse across turns** with the sliding-window layers, past 120k tokens: unknown; the card says nothing.
5. **Quantisation:** choose one that fits with headroom; sizes are not on the card.
6. A client parser exists for pi and OpenCode already; no new agent.

## Confounds

A 2.5B-active model against the Qwen3.6-35B-A3B (3B active) and Flash-Next arms (active parameters not checked here): a speed comparison favours the smaller active set by construction; quality is the point. Quantisation and engine differ per machine.

**Last checked:** 22 Oct 2026, model card and cookbook read once. **Recheck when:** quantised sizes and a Spark recipe are published; independent evaluation appears; thing1 is a node.
