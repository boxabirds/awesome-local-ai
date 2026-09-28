# gufo reads prompts 320–600% faster ("prefill") primarily by processing the model's shortcut reading layers many tokens at a time (parallelising its "linear attention"), plus a suite of hardware optimisations specific to this model

*28 September 2026*

On my Strix Halo machine, **gufo reads a long coding conversation up to 7x faster than llama.cpp**. Both ran the same model from the same files, so the difference is the engine. For a coding agent this matters a lot: re-reading a 120,000-token conversation takes about 11½ minutes on llama.cpp and about a minute and a half on gufo.

gufo gets there by being built for one chip and a small number of models, and tuning everything for them. That has costs too, which I cover at the end.

Note: part of this lead is likely temporary. What I believe is the biggest single reason for it (point 2 below) is a general method that isn't tied to AMD's chip, and llama.cpp developers have already written it. It isn't merged yet: the version for the graphics interface tritus uses has been a draft since March 2026, and the version for AMD's ROCm was opened on 24 September 2026. When it lands, llama.cpp should close some of the gap, and I'll re-test it.

## Some background first

Programs that run AI models on your own computer are called **inference engines**. llama.cpp is the one most people use. gufo is a newer one written specifically for AMD's Ryzen AI MAX+ 395 chip, better known as "Strix Halo". My test machine, tritus, has one of these chips and 128 GB of memory.

Before a model can write its reply, it has to read the whole conversation so far: every earlier message, every file it opened and every tool output. This reading step is called **prefill**. It's measured in **tokens**, which are small pieces of text (roughly ¾ of a word each). A coding agent's conversation is often 50,000–120,000 tokens long.

Normally the engine keeps what it has already read and only reads the new part. But when that saved copy is lost, it has to read the whole conversation again. The most common reason is a **compaction**, when the agent summarises its own history to free up space. This is where prefill speed really hurts.

## The numbers

I ran both engines on the same prompts, one request at a time, and made sure every prompt was read from scratch. I ran each test three times and quote the middle result.

| Conversation so far | llama.cpp | gufo | gufo faster by |
|---|---|---|---|
| 2,000 tokens | 352 tokens/s | 744 tokens/s | 2.1x (+112%) |
| 32,000 tokens | 303 tokens/s | 1,266 tokens/s | 4.2x (+318%) |
| 64,000 tokens | 237 tokens/s | 1,242 tokens/s | 5.2x (+423%) |
| 120,000 tokens | 176 tokens/s | 1,228 tokens/s | 7.0x (+596%) |

At the sizes a coding agent works with (32,000 to 120,000 tokens), **gufo is 4 to 7 times faster**. In real agent runs, a compaction took a median of 6–8 minutes on llama.cpp and under 2 minutes on gufo.

Note: llama.cpp gets slower as the conversation grows, while gufo stays almost flat. I explain why below.

(Versions: gufo `b722a61`, and llama.cpp commit `6fcaa16` using its Vulkan graphics interface. Both used the UD-Q4_K_XL model files. The raw results are in `benchmarks/gufo-eval/results/` on tritus: `20260927-172049-tritus` for llama.cpp and `20260927-181814-tritus` for gufo. The method is in the [test A plan](../../../../../../../docs/20260926-gufo-vs-llamacpp-eval-plan.md).)

## Why gufo is faster

### 1. It's built for one chip, a few models and one set of files

This is what everything else builds on. gufo only runs on Strix Halo, and it has separate hand-written code for each model it supports. For this model it supports exactly one set of files.

A model's **weights** are its learned numbers, about 111 GB of them for this model. They're usually stored at lower precision to save memory and run faster ("quantisation"). The version used here is called UD-Q4_K_XL.

It's tempting to call gufo "bare metal", but llama.cpp also has hand-written code for graphics chips. The difference is that gufo's code is written for one exact case: this model's layer sizes, this quantisation's number format and this chip's maths units. llama.cpp's code has to work for thousands of models on every kind of hardware.

### 2. It processes the shortcut layers in parallel

Most of this model's layers use a cheaper, shortcut way of reading the conversation called **linear attention** (this model's version is called **Gated DeltaNet**). It's only cheap if the code processes lots of tokens at the same time.

According to gufo's own measurements, these layers take just 9.5% of its prompt-reading time. llama.cpp's public issue tracker says its graphics-chip code for these layers still processes the tokens one after another. The parallel version has been written for both of llama.cpp's graphics back ends ([#20377](https://github.com/ggml-org/llama.cpp/pull/20377) for Vulkan and [#29353](https://github.com/ggml-org/llama.cpp/pull/29353) for AMD's ROCm), but it isn't merged or switched on yet.

**My best guess is that this is the biggest single reason for the gap.**

Note: I haven't measured this yet, which is why the headline says "primarily". I have gufo's own breakdown of where its time goes (a "profile"), but I haven't taken the same profile of llama.cpp to show where *its* time goes. A short profile on tritus would settle it.

### 3. It reads in big batches

On this chip, fetching the weights from memory takes longer than the maths itself. So the aim is to fetch each weight once and use it for as many tokens as possible.

gufo pushes **2,048 tokens** through each layer at a time, while llama.cpp on tritus does 512. That's four times as much work for every weight fetched. gufo also keeps the graphics chip (the **GPU**) busy almost all the time: its profile shows 1,363 ms of work in a 1,380 ms prompt-reading step.

### 4. It uses the chip's maths units directly

The GPU has special circuits for multiplying grids of numbers, called **matrix units** (AMD's programming interface for them is called **WMMA**). gufo writes its own code for them and reaches 30–34 trillion operations per second (**TFLOPS**), out of a measured maximum of 59.

gufo also tried AMD's own ready-made maths library (**hipBLASLt**) for the same work, and dropped it because it only reached 19–26 TFLOPS.

### 5. It doesn't slow down as the conversation grows

The model's other layers don't read everything. A small scoring step picks out the parts of the conversation worth looking at. This is called **sparse attention**, and this model's version is called **QSA**.

gufo does this scoring step efficiently, so its speed stays almost flat: 1,266 tokens per second at 32,000 tokens and 1,228 at 120,000. Over the same range llama.cpp drops from 303 to 176. That suggests llama.cpp's version of this step copes less well with long conversations, but I haven't measured inside llama.cpp to confirm it.

### 6. It only keeps speed-ups that don't change the output

gufo keeps a log of every speed-up it has tried for this model, with the evidence for keeping or dropping it. An idea only counts if the model's output stays exactly the same (**bit-identical** to a trusted reference, meaning the same down to the last digit). Most ideas pass that check and are still dropped, because they weren't actually faster once measured end to end.

## What it costs

It's not free though.

**Every new model gufo supports likely needs some dedicated attention.** A lot carries over: the server, the model-file reader, the sampling and the batching all work across models, and similar models share code. gufo already covers several: Qwen3.8 27B and Flash-Next, DeepSeek V4 Flash, MiniMax H3, and some image and speech models. But the tuned maths routines are copied per model and then tuned for that model's layer sizes, and any new kind of layer needs new code. Even the same model stored a different way ("quantisation") needs its unpacking code added to those routines, which is why gufo only supports one set of files for this model (UD-Q4_K_XL). So when a new model is released, llama.cpp usually runs it within days (slowly), while gufo runs it fast once someone has done that work.

**Part of the lead is temporary.** As I said at the top, llama.cpp has the parallel version of point 2 written but not merged. The chip- and model-specific parts (points 1, 3, 4 and 5) will stay.

**The newer parts are outside the maths.** gufo's number-crunching is very well tuned. The part that turns the model's text into tool calls for the agent is newer, and that's where my long agent runs found a bug. Now and then, when the model writes an edit containing line breaks, gufo hands the tool call back as plain text. The agent reads that as "finished" and stops. It happens about once every 500 turns, so you'd never see it in a speed test, but over hours of agent work it cuts stories off halfway. I've reported it as [gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304), and my test harness now tells the agent to carry on when it happens.

## The irony

llama.cpp started in March 2023 in much the same way. One person ported one model (Meta's original LLaMA) to plain C/C++ so it could run without PyTorch, and it was fast because it only had one job.

It became so popular that it now supports almost every model on almost every chip, and that is exactly why it's slow on this chip with this model. Some of gufo's fastest routines started life as llama.cpp code, copied and then tuned for one chip and one model. gufo is doing what llama.cpp did at the start, and if it's successful it will face the same pressure to support everything.

## Sources

- Speed measurements: test A on tritus, in `benchmarks/gufo-eval/results/` (runs of 27 September 2026).
- gufo's profile and experiment log: `docs/models/qwen3.8-flash-next/EXPERIMENTS.md` in [gufo-org/gufo](https://github.com/gufo-org/gufo) at `b722a61`.
- gufo's routines adapted from llama.cpp: `src/models/qwen38_flash_next/kernels/rocm/mmq/VENDOR.md` in the same repository (DeepSeek V4 Flash has its own copy).
- Compaction times and replays of real agent requests: [the long-session investigation](../../../../../../../docs/20260928-gufo-long-session-investigation.md).
- Why llama.cpp is slow on Strix Halo: [the Strix Halo + llama.cpp findings](../../../../../../../docs/20260927-strix-halo-llamacpp-findings.md).
