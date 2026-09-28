# gufo reads prompts 320–600% faster ("prefill") primarily by processing the model's shortcut reading layers many tokens at a time (parallelising its "linear attention"), plus a suite of hardware optimisations specific to this model

28 Sep 2026. Two programs that run AI models on your own computer ("inference engines"), gufo and
llama.cpp, compared on one machine (tritus: an AMD Ryzen AI MAX+ 395 chip, known as "Strix Halo",
with 128 GB of memory), running the same model (Qwen3.8 Flash-Next) from the same files. Exact
versions: gufo `b722a61`; llama.cpp commit `6fcaa16`, using its Vulkan graphics interface; model
files UD-Q4_K_XL (explained below).

> **How sure we are.** The speed-up is measured (below). "Primarily" is our
> best reading of the evidence, not yet a measurement: gufo's own timing breakdown of where its
> time goes (a "profile") shows those layers are cheap in gufo, and llama.cpp's public bug and
> change tracker says its graphics-chip code for them works one token at a time. We have not taken
> the same timing breakdown of llama.cpp to show that this is where most of its time goes; a short
> one on tritus would settle it.

## The numbers

Prompt reading speed, one request at a time, every prompt read from scratch
([test A](../../../../../../../docs/20260926-gufo-vs-llamacpp-eval-plan.md), same weights and prompts for both; medians of 3; llama.cpp from
its second pass, results `20260927-172049-tritus`, gufo from `20260927-181814-tritus`):

| Conversation so far | llama.cpp | gufo | gufo faster by |
|---|---|---|---|
| 2,000 tokens | 352 tokens/s | 744 tokens/s | 2.1× (+112%) |
| 32,000 tokens | 303 tokens/s | 1,266 tokens/s | 4.2× (+318%) |
| 64,000 tokens | 237 tokens/s | 1,242 tokens/s | 5.2× (+423%) |
| 120,000 tokens | 176 tokens/s | 1,228 tokens/s | 7.0× (+596%) |

At the sizes a coding agent works with (32,000–120,000 tokens) that is **4.2–7.0× faster, +320–600%**.
In practice: re-reading a 120,000-token conversation takes about 11½ minutes with llama.cpp and
about 1½ with gufo; an agent's history summary ("compaction") took a median 6–8 minutes on
llama.cpp and under 2 on gufo.

## First, what "prefill" is

Before a model can write a reply it has to read the whole conversation so far: every earlier
message, file and tool output. That reading step is **prefill**. It is measured in **tokens**
(pieces of text, roughly ¾ of a word each). A coding agent's conversation is often
50,000–120,000 tokens. Normally the engine keeps its reading of the conversation and only reads what
is new, but whenever that saved copy is lost (after a **compaction**, where the agent summarises its
history to free up space, or after a restart) the whole conversation has to be read again.

## Why gufo is faster

**1. It is built for one chip, one model and one version of its weights.** gufo runs only on AMD's
Strix Halo chip and ships separate hand-written code for each model it supports. For this model it
supports exactly one **quantization** (weights stored with fewer bits to save memory; this one is
called UD-Q4_K_XL). The **weights** are the model's learned numbers, about 111 GB here, and each one
has to be fetched from memory to be used. This is not "closer to the metal" than llama.cpp, which
also has hand-written graphics-chip code; the difference is that gufo writes it for one exact
shape (this model's layer sizes, this quantization's number format, this chip's maths units)
where llama.cpp's has to serve thousands of models on every kind of hardware.

**2. It processes the linear-attention layers in parallel.** Most of this model's layers use a
shortcut form of reading called **linear attention** (this model's version is called
**Gated DeltaNet**). It is cheap in principle, but only if the code processes many tokens at once.
In gufo these layers take 9.5% of prompt-reading time (gufo's own profile). According to llama.cpp's
issue tracker, its graphics-chip code for them still processes tokens one after another during
prefill; parallel ("chunked") versions exist as unmerged or switched-off pull requests (llama.cpp
[#20377](https://github.com/ggml-org/llama.cpp/pull/20377) for Vulkan,
[#29353](https://github.com/ggml-org/llama.cpp/pull/29353) for ROCm). This is our best candidate for
the largest single difference (see "How sure we are" above).

**3. It reads in big batches.** On this chip the slow part is fetching weights from memory, not the
arithmetic, so the aim is to fetch each weight once and use it for as many tokens as possible. gufo
sends **2,048 tokens** through each layer at a time (its request log: `prefill_chunks=33,
max_prefill_chunk_tokens=2048` for a 65,000-token prompt), against llama.cpp's 512 on tritus. Its
profile shows the graphics chip (**GPU**) busy for 1,363 ms of a 1,380 ms prompt-reading step:
almost no time lost waiting.

**4. It uses the chip's special maths units directly.** The GPU has circuits made for multiplying
grids of numbers (**matrix units**; AMD's programming interface for them is called **WMMA**). gufo
writes its own code for them and reaches 30–34 trillion operations a second (**TFLOPS**) against a
measured maximum of 59. It tried AMD's ready-made maths library (**hipBLASLt**) for the same work and
dropped it: 19–26 TFLOPS.

**5. It doesn't slow down as the conversation grows.** This model's remaining layers skip most of
the conversation: a small scoring step picks the parts worth looking at (**sparse attention**; this
model's version is called **QSA**). gufo implements that step efficiently, so its reading speed stays
nearly flat (1,266 tokens/s at 32,000 tokens, 1,228 at 120,000), while llama.cpp's falls from 303 to
176. That suggests llama.cpp's version of this step scales worse with length; we have not measured
inside llama.cpp to confirm it.

**6. It only keeps speed-ups that change nothing.** gufo's experiment log keeps an optimisation only
if the model's output stays **bit-identical** (exactly the same to the last digit), and records many
faster ideas it rejected for changing results.

## What it costs

- **Every new quantization is real work.** Each number format needs its own unpacking code inside
  the tuned routines, so a new quantization is kernel work, not configuration. Choosing gufo also
  fixes the weights: for this model, UD-Q4_K_XL only.
- **A new model reuses the scaffolding but needs attention.** The batching, matrix-unit building
  blocks, saving of conversations and the server carry over (gufo already covers several models:
  Qwen3.8 27B and Flash-Next, DeepSeek V4 Flash, MiniMax H3, and image and speech models); each new
  kind of layer, or new layer size, needs its own tuning. In practice: when a model is released,
  llama.cpp usually runs it within days, slowly; gufo runs it fast once someone has done the work.
- **Part of the lead is temporary.** Point 2 is an algorithm choice, not chip tuning, and llama.cpp
  already has the parallel code waiting. When it lands, a large part of the gap should close; the
  chip- and model-specific parts (points 1, 3, 4, 5) will not. Re-test llama.cpp on tritus then.
- **The young parts are outside the maths.** The routines are carefully tuned; the layer that turns
  the model's text into structured tool calls for the agent is newer. That is where our long agent
  runs found a bug: a tool call with line breaks inside it comes back as plain text and the agent
  stops as if finished ([gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304), about 1 in
  500 turns). Speed tests of single requests would never show it; hours of agent work do.

## The irony

llama.cpp began in March 2023 as exactly this: one person porting one model (Meta's original LLaMA)
to plain C/C++ to run it without PyTorch, fast because it was narrow. Its success made it everyone's
engine, and supporting every model on every chip is what now leaves it slow on this new chip and
model. gufo is repeating the cycle one level down; if it succeeds, the same pressure to generalise
will arrive.

## Sources

- Speed measurements: test A on tritus, `benchmarks/gufo-eval/results/` (runs of 27 Sep 2026).
- gufo's profile and experiment log: `docs/models/qwen3.8-flash-next/EXPERIMENTS.md` in
  [gufo-org/gufo](https://github.com/gufo-org/gufo) at `b722a61`.
- Compaction times and real-request replays: [the long-session investigation](../../../../../../../docs/20260928-gufo-long-session-investigation.md).
- llama.cpp's slow prefill on this chip: [the Strix Halo + llama.cpp findings](../../../../../../../docs/20260927-strix-halo-llamacpp-findings.md).
