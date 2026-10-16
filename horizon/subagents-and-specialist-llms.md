# Subagents and specialist LLMs: small models doing the simple agentic tasks

**Status:** open question (16 Oct 2026). Added at the owner's request. Nothing here has been run or installed. Facts come from
one project page read on 16 Oct 2026 and from press coverage of it (linked below); none is our measurement.
**Kind:** a way of using models rather than one model. A main coding agent hands a bounded job to a second agent (a
**subagent**) or to a model chosen for one narrow job (a **specialist**), and gets a short answer back. The question is whether
a very small model can do the simple jobs, so the large model's context stays short and its time goes to the hard work.
**Where it could run:** the small model is the cheap part, so it fits beside a large one on the machines we have: the Mac with
128 GB, the RTX 4090 (24 GB, tight next to a large model), the Strix Halo box. It also runs alone on a 16 GB Mac, which the
repo has already measured for the 27B Bonsai (below).

## What it is

Two ideas that are often mixed up:

- **A subagent** is a separate agent run with its own context for one job (find where this function is used, run the tests and
  say which fail, summarise this log). The main agent sees only the result. Whether pi and OpenCode, the clients of our stacks,
  support delegating to a second model or endpoint has **not been checked**.
- **A specialist model** is a model picked for one job because it is small, fast or tuned for it: choosing a tool, extracting
  fields, summarising, searching files. It does not have to be an agent at all.

## The example that prompted the note: Bonsai

[PrismML's Bonsai](https://github.com/PrismML-Eng/Bonsai-demo) are models stored in very few bits per weight, which is what
makes the small ones tiny. What the project page says (read 16 Oct 2026):

| Family | Sizes | Format | Notes from the page |
|---|---|---|---|
| Bonsai 2 | 2B, 4B, 9B, 27B | ternary, GGUF and MLX 2-bit builds | the 27B is the default of the demo; the page gives file size and memory only for the 27B (7.8 GB in `PQ2_0`, about 6.3 GiB of FP16 KV cache at 100K context) |
| earlier Bonsai (1-bit and ternary) | 27B, 8B, 4B, 1.7B | 1-bit and ternary | the page points to a separate readme and does not describe them |

The page says "Pick a smaller model for a lighter local setup" and gives **no task for the 2B, 4B or 9B**; its tool-calling and
agent notes are written for the 27B. The repository is Apache-2.0; the page does **not** state the licence of the weights
(press coverage says Apache 2.0 for the 1-bit models; not checked on a model card). A licence is a fact here, not a gate.

What press coverage reports about the family ([The Register](https://www.theregister.com/2026/04/04/prismml_1bit_llm/),
[The Decoder](https://the-decoder.com/bonsai-27b-is-a-full-open-reasoning-model-that-fits-on-an-iphone/),
[PrismML's announcement](https://prismml.com/news/prismml-releases-bonsai-27b)), all second-hand and not ours:

- The 1-bit 8B, 4B and 1.7B models exist; the 1-bit 27B is about 3.9 GB.
- Across PrismML's 15 benchmarks the 1-bit build keeps about 90% of the full-precision score, and **agentic and tool-calling
  scores fall the most**: for the 27B, 66.0 against 80.0 on the agentic and tool-calling group and 61.3 against 82 on Tau2-Bench.
- A community 98-question test put the 1-bit 27B at 82.9% against 94.2% for the original Qwen3.6-27B.
- **I found no tool-calling or agentic figure for the 1.7B, 4B, 8B or Bonsai 2's 2B, 4B and 9B.** Whether they can do even a
  simple tool-using task is unknown. That is the question.

What the repo already holds on Bonsai (our own, on the 27B only): [Measuring Bonsai 2 27B on Apple silicon](../docs/measuring-bonsai2-on-apple-silicon.md),
the [MacBook Air M2 16GB probe](../docs/research/20260918-bonsai2-apple-silicon-m2-16gb/) (3.83 tok/s at 128 tokens,
falling from 7.63 to 4.23 over five soak runs on a fanless machine, verbose and repetitive output) and the
[concurrent-sessions note](../docs/research/20260918-bonsai2-concurrent-sessions.md). None of it covers the small sizes.

Other specialists and subagent set-ups would go in this note as they are found. None has been looked at yet.

## What it would be compared with

The same stories on the same main model, once alone and once with a small helper for the simple jobs. The comparison that
matters is **final held-out quality first**, then tokens and time (the owner's order of importance). A helper that makes the
main model faster but a little worse is not a win.

## Checks before a run

In this order. None has been done.

1. **Can the small model call a tool at all?** Run `tools/engine-probe/basic-capability.py` against the 2B, 4B and 9B Bonsai 2
   (and the 1.7B, 4B and 8B 1-bit models) over their OpenAI-compatible API: a plain call, arguments with raw newlines, a large
   argument. A failure here is the engine or the build, not a finding about subagents.
2. **A simple job, scored by us.** Pick the jobs a subagent would do in our stories (list the files that mention X; run the
   test command and report the failing test names; read a log and say whether it finished). Write each as a task with a known
   answer and count how often each size gets it right. No judgement by the model itself.
3. **Does a client support it?** Whether pi or OpenCode can send a job to a second model or endpoint, and how the answer comes
   back. If neither can, the experiment needs a thin wrapper, and that wrapper is a confound.
4. **Memory.** A second model competes with the main one for memory and bandwidth. Measure both together on the 24 GB card and
   on the Macs before any run; [concurrency](concurrency.md) was not re-read for this note.
5. Then the ten-minute smoke rule, a queued series, and watching story 1.

## Confounds

- **The build, not only the size.** Very-low-bit models lose most on tool calling; a failure may be the packing and not the
  idea. Compare sizes within one family before comparing across.
- **Different engines.** Some Bonsai builds need PrismML's llama.cpp fork or MLX; our other stacks use other engines.
- **The wrapper.** If the client cannot delegate, anything we add to make it do so is part of the result.
- **Verbosity.** The one run we have (27B on a 16 GB Air) shows repetition; a small helper that repeats itself costs the main
  model's context instead of saving it. Count the helper's output tokens.
- **Fanless machines throttle.** A helper on a 16 GB Air slows by about 45% inside five runs; do not read a first-minute rate.

## Why it is worth the check

If a 2B to 9B model can do the simple, bounded jobs reliably, a long coding session gets cheaper in the large model's context
and time, and a 16 GB machine could take a useful part in the work. If it cannot, that is a clear result for the people
choosing small models for agents, and cheap for us to establish with checks 1 and 2 before any benchmark run is spent.

**Last checked:** 16 Oct 2026, from the Bonsai-demo page, three press articles and our own earlier Bonsai notes. Not run.
**Recheck when:** a model card or paper reports tool-calling results for a small Bonsai or another small model; pi or OpenCode
documents delegation to a second model; check 1 is done.
