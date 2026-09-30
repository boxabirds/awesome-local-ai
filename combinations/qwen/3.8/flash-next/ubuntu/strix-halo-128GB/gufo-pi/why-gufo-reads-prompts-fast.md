# gufo reads prompts 320–600% faster ("prefill") primarily by doing the model's core multiplications much faster on this chip, plus a suite of hardware optimisations specific to this model

*28 September 2026*

On my Strix Halo machine, **gufo reads a long coding conversation up to 7x faster than llama.cpp**. Both ran the same model from the same files, so the difference is the engine. For a coding agent this matters a lot: re-reading a 120,000-token conversation takes about 11½ minutes on llama.cpp and about a minute and a half on gufo.

gufo gets there by being built for one chip and a small number of models, and tuning everything for them. That has costs too, which I cover at the end.

Note: an earlier version of this page said the main reason was the way gufo handles the model's shortcut layers (point 2 below), and that an upcoming change to llama.cpp would close much of the gap. That was wrong. I've since measured where llama.cpp's time goes, and those layers take less than 2% of it. Most of its time goes on the model's core multiplications, and gufo simply does those much faster.

## Some background first

Programs that run AI models on your own computer are called **inference engines**. llama.cpp is the one most people use, often without knowing it. Since it started in 2023 it has become the foundation of running AI at home:

- It has about 130,000 stars on GitHub (a rough measure of popularity) and nearly 24,000 "forks", copies people have made to build on.
- Its model file format, **GGUF**, is the standard way to share models for home use. Hugging Face, the main site for sharing AI models, lists over 200,000 models in that format.
- Ollama, one of the most popular ways to run models at home (about 180,000 GitHub stars of its own), runs llama.cpp underneath.
- It moves fast: it has put out more than 11,000 numbered releases since 2023.

(Figures as of 28 September 2026.)

gufo is a newer one written specifically for AMD's Ryzen AI MAX+ 395 chip, better known as "Strix Halo". My test machine, a Minisforum MS-S1 MAX, has one of these chips and 128 GB of memory.

Before a model can write its reply, it has to read the whole conversation so far: every earlier message, every file it opened and every tool output. This reading step is called **prefill**. It's measured in **tokens**, which are small pieces of text (roughly ¾ of a word each). A coding agent's conversation is often 50,000–120,000 tokens long.

Normally the engine keeps what it has already read and only reads the new part. But sometimes it has to read the whole conversation again, and there are two common reasons.

The first is resuming a session, for example when you reopen your coding agent the next day. Unless the engine still has that conversation in memory, it reads the whole thing from the start. This catches people out, because it's new behaviour for anyone used to cloud AI. You reopen a long session and wait minutes before anything happens, and it's not obvious why.

The second is a **compaction**, when the agent summarises its own history to free up space. The conversation has changed, so the engine starts over. How often this happens depends on the **context window**, which is the most the model can read at once. Many of today's frontier cloud models offer around a million tokens. The model I'm using can go up to 262,144, but I run it at 131,072 (128k) as a balance: a bigger window needs more memory, and a smaller one means more compactions, each of which interrupts the work. Local setups usually end up with smaller windows than the cloud, so they compact more often.

**Prefill speed directly affects how long compactions and resumed sessions take, and gufo makes Strix Halo's prefill times practical.** Re-reading a 120,000-token conversation takes about 11½ minutes on llama.cpp and about a minute and a half on gufo.

The wait is a fairly new experience for most people. Cloud AI runs on very expensive hardware that reads something like 10 times faster than even gufo manages on Strix Halo, so you rarely notice it there (see the sidebar).

It's also one of the benefits of owning an RTX graphics card. A current card like the RTX 4090 or 5090 reads the model that fits on it (Qwen3.8 27B) at about 2,900 to 3,900 tokens a second, which is 2 to 3 times gufo's speed here. RTX owners notice compactions and resumed sessions much less.

> **Sidebar: how do cloud models resume so quickly?**
>
> Mostly because they don't re-read, and when they do, they read very fast.
>
> The providers keep the model's working memory of a conversation (its **KV cache**) for a while after each request, and reuse it when the same conversation comes back. This is called **prompt caching**. Anthropic keeps it for 5 minutes by default, or an hour if you pay for it, and charges a tenth of the normal price or less to reuse it. OpenAI keeps it for about 30 minutes on its newest models. DeepSeek saves it to disk for hours to days, and said in 2024 that a cached 128,000-token prompt starts replying in half a second instead of 13 seconds. Moonshot, which runs the Kimi service, has published how it does this at scale ("Mooncake"): the saved memory is spread across the spare RAM and SSDs of the whole GPU cluster.
>
> When the cache has expired, as it usually will if you come back the next day, the cloud does re-read the whole conversation. But DeepSeek's 13 seconds for 128,000 tokens with no cache works out at roughly 10,000 tokens a second, on 2024 hardware. That's about 8 times gufo on the Strix Halo box and over 50 times llama.cpp, so the re-read takes seconds, not minutes.
>
> The caching part isn't cloud-only. Local engines keep the cache while they're running, and llama.cpp can save it to disk (its `--slot-save-path` option). The speed of reading is the real difference.

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

(Versions: gufo `b722a61`, and llama.cpp commit `6fcaa16` using its Vulkan graphics interface. Both used the UD-Q4_K_XL model files. The raw results are in `benchmarks/gufo-eval/results/` on the Strix Halo box: `20260927-172049` for llama.cpp and `20260927-181814` for gufo. The method is in the [test A plan](../../../../../../../docs/20260926-gufo-vs-llamacpp-eval-plan.md).)

## Where llama.cpp's time goes

To find out, I timed every step llama.cpp takes while reading a prompt (a "profile"), using the same model files and the same settings as the speed test.

| Prompt length | llama.cpp speed | Core multiplications | Attention | Shortcut layers |
|---|---|---|---|---|
| 2,000 tokens | 491 tokens/s | 77% | 1.5% | 1.9% |
| 32,000 tokens | 384 tokens/s | 62% | 20% | 1.5% |
| 64,000 tokens | 284 tokens/s | 58% | 23% | 1.6% |

Two things stand out.

**Most of the time goes on the core multiplications**, where the conversation is multiplied by the model's weights. That's the same in gufo: its own profile puts about 64% of its time there. The difference is speed. At 32,000 tokens llama.cpp spends about 52 seconds on these multiplications alone, which is twice as long as gufo takes to read the whole prompt (26 seconds).

**Attention is the part that grows.** Attention is the step where each new piece of text looks back over the conversation so far. It's 1.5% of llama.cpp's time on a short prompt and nearly a quarter of it at 64,000 tokens. That's why llama.cpp slows down as the conversation grows.

Note: this profile used llama.cpp's own benchmark tool, which reads a little faster than the server did in my speed test (384 against 303 tokens per second at 32,000 tokens). The timing itself cost almost nothing: the same run without it was 389 tokens per second.

## Why gufo is faster

### 1. It's built for one chip, a few models and one set of files

This is what everything else builds on. gufo only runs on Strix Halo, and it has separate hand-written code for each model it supports. For this model it supports exactly one set of files.

A model's **weights** are its learned numbers, about 111 GB of them for this model. They're usually stored at lower precision to save memory and run faster ("quantisation"). The version used here is called UD-Q4_K_XL.

It's tempting to call gufo "bare metal", but llama.cpp also has hand-written code for graphics chips. The difference is that gufo's code is written for one exact case: this model's layer sizes, this quantisation's number format and this chip's maths units. llama.cpp's code has to work for thousands of models on every kind of hardware.

### 2. It processes the shortcut layers in parallel

Most of this model's layers use a cheaper, shortcut way of reading the conversation called **linear attention** (this model's version is called **Gated DeltaNet**). It's only cheap if the code processes lots of tokens at the same time.

According to gufo's own measurements, these layers take just 9.5% of its prompt-reading time. llama.cpp's public issue tracker says its graphics-chip code for these layers still processes the tokens one after another. The parallel version has been written for both of llama.cpp's graphics back ends ([#20377](https://github.com/ggml-org/llama.cpp/pull/20377) for Vulkan and [#29353](https://github.com/ggml-org/llama.cpp/pull/29353) for AMD's ROCm), but it isn't merged or switched on yet.

**This turns out to be a tiny part of the gap.** In my profile these layers take less than 2% of llama.cpp's time, even processed one token after another. The developer of the ROCm version measured the parallel code at 6.8–7.0% faster prompt reading on a Strix Halo (with the 27B version of Qwen3.8, where the layers take a bigger share). They're a larger share of gufo's time (9.5%) only because gufo does everything else so much faster.

### 3. It reads in big batches

On this chip, fetching the weights from memory takes longer than the maths itself. So the aim is to fetch each weight once and use it for as many tokens as possible.

gufo pushes **2,048 tokens** through each layer at a time, while llama.cpp on the Strix Halo box does 512. That's four times as much work for every weight fetched. But bigger batches alone don't do it: I tried llama.cpp at 2,048 too. It was a little faster on a short prompt (530 tokens per second against 491) and slower on long ones (233 against 284 at 64,000 tokens). The batch size only pays off because of what gufo's code does with it. gufo also keeps the graphics chip (the **GPU**) busy almost all the time: its profile shows 1,363 ms of work in a 1,380 ms prompt-reading step.

### 4. It uses the chip's maths units directly

The GPU has special circuits for multiplying grids of numbers, called **matrix units** (AMD's programming interface for them is called **WMMA**). gufo writes its own code for them and reaches 30–34 trillion operations per second (**TFLOPS**), out of a measured maximum of 59.

gufo also tried AMD's own ready-made maths library (**hipBLASLt**) for the same work, and dropped it because it only reached 19–26 TFLOPS.

**This is the biggest single reason for the gap.** The core multiplications are most of the work in both engines (see the profile above), and this is where gufo is much faster.

### 5. It doesn't slow down as the conversation grows

The model's other layers don't read everything. A small scoring step picks out the parts of the conversation worth looking at. This is called **sparse attention**, and this model's version is called **QSA**.

gufo does this scoring step efficiently, so its speed stays almost flat: 1,266 tokens per second at 32,000 tokens and 1,228 at 120,000. Over the same range llama.cpp drops from 303 to 176, and the profile shows why: its attention step grows from 1.5% of its time on a short prompt to nearly a quarter at 64,000 tokens. That's the part of the gap that grows with length.

### 6. It only keeps speed-ups that don't change the output

gufo keeps a log of every speed-up it has tried for this model, with the evidence for keeping or dropping it. An idea only counts if the model's output stays exactly the same (**bit-identical** to a trusted reference, meaning the same down to the last digit). Most ideas pass that check and are still dropped, because they weren't actually faster once measured end to end.

## What it costs

It's not free though.

**Every new model gufo supports likely needs some dedicated attention.** A lot carries over: the server, the model-file reader, the sampling and the batching all work across models, and similar models share code. gufo already covers several: Qwen3.8 27B and Flash-Next, DeepSeek V4 Flash, MiniMax H3, and some image and speech models. But the tuned maths routines are copied per model and then tuned for that model's layer sizes, and any new kind of layer needs new code. Even the same model stored a different way ("quantisation") needs its unpacking code added to those routines, which is why gufo only supports one set of files for this model (UD-Q4_K_XL). So when a new model is released, llama.cpp usually runs it within days (slowly), while gufo runs it fast once someone has done that work.

**Very little of the lead is temporary.** llama.cpp has the parallel version of point 2 written but not merged, and on this setup it can save at most the 2% those layers take. The chip- and model-specific parts (points 1, 3, 4 and 5) are where the gap is, and they'll stay.

**The newer parts are outside the maths.** gufo's number-crunching is very well tuned. The part that turns the model's text into tool calls for the agent is newer, and that's where my long agent runs found a bug. Now and then, when the model writes an edit containing line breaks, gufo hands the tool call back as plain text. The agent reads that as "finished" and stops. It happens about once every 500 turns, so you'd never see it in a speed test, but over hours of agent work it cuts stories off halfway. I've reported it as [gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304), and my test harness now tells the agent to carry on when it happens.

## The irony

llama.cpp started in March 2023 in much the same way. One person ported one model (Meta's original LLaMA) to plain C/C++ so it could run without PyTorch, and it was fast because it only had one job.

It became so popular that it now supports almost every model on almost every chip, and that is exactly why it's slow on this chip with this model. Some of gufo's fastest routines started life as llama.cpp code, copied and then tuned for one chip and one model. gufo is doing what llama.cpp did at the start, and if it's successful it will face the same pressure to support everything.

## Sources

- llama.cpp profile: `benchmarks/gufo-eval/results/20260928-032534-llama-prefill-profile` on the Strix Halo box, made with [llama-prefill-profile.sh](../../../../../../../benchmarks/gufo-eval/llama-prefill-profile.sh) (llama.cpp `6fcaa16`, Vulkan, `GGML_VK_PERF_LOGGER`). "Core multiplications" is `MUL_MAT` plus `MUL_MAT_ID`, "attention" is `FLASH_ATTN_EXT` plus `TOPK_QSA`, and "shortcut layers" is `GATED_DELTA_NET`. gufo's shares are from its d0 and d32K profiles in its experiment log.

- Cloud prompt caching: [Anthropic](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching), [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), [DeepSeek's 2024 announcement](https://api-docs.deepseek.com/news/news0802/) (the 13 s to 0.5 s figure) and Moonshot's [Mooncake paper](https://arxiv.org/abs/2407.00079), read on 28 September 2026.
- Home graphics cards: the tables in [llama.cpp #29353](https://github.com/ggml-org/llama.cpp/pull/29353) (the numbers before the change; the quantisations differ slightly: Q8 on Strix Halo, Q4_K_M on the NVIDIA cards), and my RTX 4090 measurement in the [Qwen3.8 27B combination](../../../../27b/ubuntu/nvidia4090/llamacpp-pi/README.md) (pp2048 at about 2,915 tokens/s).
- llama.cpp's reach: the GitHub pages for [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) (stars, forks, latest release b11223) and [ollama/ollama](https://github.com/ollama/ollama) (its `LLAMA_CPP_VERSION` file pins llama.cpp), and the [GGUF model list on Hugging Face](https://huggingface.co/models?library=gguf), all on 28 September 2026.

- Speed measurements: test A on the Strix Halo box, in `benchmarks/gufo-eval/results/` (runs of 27 September 2026).
- gufo's profile and experiment log: `docs/models/qwen3.8-flash-next/EXPERIMENTS.md` in [gufo-org/gufo](https://github.com/gufo-org/gufo) at `b722a61`.
- gufo's routines adapted from llama.cpp: `src/models/qwen38_flash_next/kernels/rocm/mmq/VENDOR.md` in the same repository (DeepSeek V4 Flash has its own copy).
- Compaction times and replays of real agent requests: [the long-session investigation](../../../../../../../docs/20260928-gufo-long-session-investigation.md).
- Why llama.cpp is slow on Strix Halo: [the Strix Halo + llama.cpp findings](../../../../../../../docs/20260927-strix-halo-llamacpp-findings.md).
