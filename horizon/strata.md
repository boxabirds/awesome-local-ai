# Strata

**Status:** gated (29 Sep 2026).
**Machine:** gruntus (RTX 4090, Ubuntu or Windows). Would give gruntus a Flash-Next stack, the same model
family as tritus and quintus, for a hardware comparison we don't have.

## What it is

An MIT-licensed server that runs Qwen3.8 Flash-Next (125B mixture-of-experts) on one consumer NVIDIA card
(RTX 30/40/50, 12 GB or more; AMD 7900 XT/XTX experimental on Linux): the busiest experts on the GPU, all of
them in RAM, a lookup table on the SSD. OpenAI- and Anthropic-compatible API, reasoning effort off/low/medium/
high, MTP drafting. Version 0.1.x. Models: the original Flash-Next, ISTA-DASLab's Coder (half the experts
removed) and UkisAI's Swift 1.5 for Flash-Next, at Q2_0, IQ2_XS, IQ3_XXS or IQ3_S.

## Checks before a run

1. Tool calls: the docs cover chat and "MCP tools" in its own interface; OpenAI `tools` / tool-call
   support over the API is not confirmed.
2. Cross-turn caching: the same multi-turn test past 120k tokens as [TensorFold](tensorfold.md). Its own
   figures give 4.5 minutes to read a 262k prompt, so re-reading every turn would be a blocker.
3. Memory: it needs "shard 1 + about 10 GB" of RAM (it loads 35-55 GB); gruntus has 62 GB and a run also
   puts the agent, browsers and test servers there. Check the memory guard's headroom on a real story.
4. Then a one-story smoke test.

## Confounds

1- to 3-bit quantisation (GSQ-RCO) against our IQ4_XS and mixed 4/8-bit Flash-Next runs; the Coder variant
is effectively a different model. Start with the full model at IQ3_S.

**Last checked:** 29 Sep 2026. **Recheck when:** gruntus has a free Ubuntu slot after the v2 runs.

Sources: [Strata](https://github.com/Niko1221/Strata) ·
[DETAILS.md](https://github.com/Niko1221/Strata/blob/main/docs/DETAILS.md) ·
[Coder GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF) ·
[Swift 1.5 Flash-Next GGUF](https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF)
