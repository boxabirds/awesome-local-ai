# Flash-Next Coder (GSQ-RCO, half the experts removed)

**Status:** candidate (2 Oct 2026), behind [Strata](strata.md): it would run on the same engine, so Strata's
checks come first.
**Kind:** a different model, not another size of Flash-Next. Half of the routed experts are gone.
**Machine:** the RTX 4090 machine (24 GB VRAM, 63 GB RAM), through Strata (`--family coder`, size IQ1_M).

## What it is

ISTA-DASLab's `Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF` (revision `5348543e`, last changed 29 Sep 2026): Qwen3.8
Flash-Next with 256 of its 512 experts per layer removed and the rest stored at 3.5 bits per weight. The experts
kept were chosen (with RCO, by KL divergence against the full model on calibration data) for code, agentic tool
use, vision and spatial reasoning; the card says other capabilities are expected to degrade.

- Two files, both needed: 29.6 GB of transformer weights, which must be in memory, and a 28.8 GB n-gram table,
  which can stay on disk. 58.4 GB in all, against 354 GB for the BF16 original.
- The card's results, all measured at xhigh reasoning effort: SWE-bench Verified 75.60 against the original's
  82.80 (91.3% kept); LiveCodeBench v6 86.28 against 87.43 (98.7% kept). The card itself notes that long
  multi-step tasks lose more than single problems.
- The card calls it an experimental release.
- Loads in llama.cpp (given the first file) and in Strata, which the card recommends. Strata's guide says it
  fits a PC with 32 GB of RAM, runs a 262K context on 64 GB, and reads long prompts fastest of its sizes; it also
  reports it weaker outside code, including Chinese and other CJK text (Strata issue 438).

## Why it is interesting here

Our stories are long agentic coding sessions, the case the card says loses most (91% on SWE-bench Verified). It
uses about 30 GB of memory where Flash-Next IQ3_XXS uses about 43 GB by Strata's estimate, which leaves more of
the 63 GB for the agent, the browsers and the test servers. Whether the smaller model still passes our held-out
tests is the question a run would answer.

## Checks before a run

1. [Strata](strata.md)'s own checks pass on the RTX 4090 machine with the full model (tool calls over the API,
   cache reuse across turns past 120k tokens, memory on a real story).
2. Install it beside the full model (`./setup.sh --setup --family coder --no-start`; Strata's guide says it shares
   the full model's second file, so about 30 GB more to download) and repeat the tool-call check: the experts
   removed could change tool-call behaviour.
3. Then a one-story smoke test.

## Confounds

- Not the same model as any other Flash-Next stack: half the experts, chosen for code. A result says something
  about this pruned model on Strata, not about Flash-Next.
- The card's scores are at xhigh reasoning effort; our Flash-Next stacks run at low.
- Licence: the page's metadata says apache-2.0, and its licence section says the weights inherit the base
  model's licence. Not resolved here.

**Last checked:** 2 Oct 2026 (model card, file list, Strata's model guide at v0.1.36). **Recheck when:** Strata's
checks have passed, or the repository publishes a new revision.

Sources: [model card](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-Coder-GGUF) ·
[RCO paper](https://arxiv.org/abs/2605.00649) · [GSQ paper](https://arxiv.org/abs/2604.18556) ·
[Strata model guide](https://github.com/Niko1221/Strata/blob/main/docs/MODELS.md)
