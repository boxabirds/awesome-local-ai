# gufo reads prompts 320–600% faster ("prefill") primarily by processing the model's shortcut reading layers many tokens at a time (parallelising its "linear attention"), plus a suite of hardware optimisations specific to this model

*28 September 2026*

On my Strix Halo box, gufo reads a long coding conversation up to seven times faster than llama.cpp. Same machine, same model, same files. That's not a rounding error — it's the difference between an agent that waits 11½ minutes to get going again and one that waits a minute and a half.

So what's going on? The short version: gufo is built for exactly one chip and a handful of models, and it squeezes every drop out of that narrow target. The longer version is below — and it comes with a few costs worth knowing about.

## First, some plumbing

A couple of things to get straight before the numbers make sense.

Programs that run AI models on your own computer are called **inference engines**. llama.cpp is the one most people use; gufo is a newer one written specifically for AMD's Ryzen AI MAX+ 395 chip (better known as "Strix Halo"). My machine, tritus, is one of those, with 128 GB of memory.

Before a model can write a single word of its reply, it has to read the whole conversation so far — every earlier message, every file it opened, every tool output. That reading step is called **prefill**. It's measured in **tokens**: little pieces of text, roughly three-quarters of a word each. A coding agent's conversation easily runs to 50,000–120,000 tokens.

Normally the engine keeps its reading of the conversation and only has to read what's new. But whenever that saved copy is lost, the whole lot has to be read again — for example after a **compaction**, which is when the agent summarises its own history to free up space. That's where prefill speed really bites.

## The numbers

I ran both engines on the same prompts, one request at a time, forcing every prompt to be read from scratch so nothing could be reused. Three runs of each, and I'm quoting the middle one:

| Conversation so far | llama.cpp | gufo | gufo faster by |
|---|---|---|---|
| 2,000 tokens | 352 tokens/s | 744 tokens/s | 2.1× (+112%) |
| 32,000 tokens | 303 tokens/s | 1,266 tokens/s | 4.2× (+318%) |
| 64,000 tokens | 237 tokens/s | 1,242 tokens/s | 5.2× (+423%) |
| 120,000 tokens | 176 tokens/s | 1,228 tokens/s | 7.0× (+596%) |

At the sizes a coding agent actually works with — 32,000 to 120,000 tokens — that's **4 to 7 times faster**. Re-reading a 120,000-token conversation takes about 11½ minutes with llama.cpp and about a minute and a half with gufo. In real agent runs, a compaction took a median of 6–8 minutes on llama.cpp and under 2 on gufo.

Note: look at how the two columns behave as the conversation grows. llama.cpp gets steadily slower; gufo barely moves. More on that below.

(For the record: gufo version `b722a61`, llama.cpp commit `6fcaa16` using its Vulkan graphics interface, both on the same model files, UD-Q4_K_XL. The raw results are in `benchmarks/gufo-eval/results/` on tritus — `20260927-172049-tritus` for llama.cpp and `20260927-181814-tritus` for gufo — and the full method is in the [test A plan](../../../../../../../docs/20260926-gufo-vs-llamacpp-eval-plan.md).)

## Why gufo is faster

### It's built for one chip, one model, one set of files

This is the big one, and it underpins everything else.

gufo runs on Strix Halo and nothing else, and it ships separate, hand-written code for each model it supports. For this model it supports exactly one version of the files. A model's **weights** are its learned numbers — about 111 GB of them here — and they're usually stored at reduced precision to save memory and run faster. Reducing precision like that is called **quantisation**, and this particular recipe is called UD-Q4_K_XL.

It's tempting to call this "bare metal", but that's not quite right. llama.cpp also has hand-written code for graphics chips. The difference is what that code is written *for*: gufo's targets one exact shape — this model's layer sizes, this quantisation's number format, this chip's maths units — while llama.cpp's has to serve thousands of models on every kind of hardware. Specialisation, not a lower level.

### It reads the shortcut layers in parallel

Most of this model's layers use a cheaper, shortcut way of reading the conversation called **linear attention** (this model's flavour is called **Gated DeltaNet**). It's cheap in principle — but only if the code processes lots of tokens at once.

In gufo, these layers take just 9.5% of prompt-reading time, according to its own timing breakdown. llama.cpp's public issue tracker says its graphics-chip code for them still works through the tokens one after another. The parallel version exists for both of llama.cpp's graphics back ends ([#20377](https://github.com/ggml-org/llama.cpp/pull/20377) for Vulkan, [#29353](https://github.com/ggml-org/llama.cpp/pull/29353) for AMD's ROCm) — it just hasn't been merged or switched on yet.

My best guess is that this is the single biggest reason for the gap.

Note: that's a guess, not a measurement — hence "primarily" in the headline. I have gufo's own timing breakdown (what engineers call a **profile**), but I haven't taken the same breakdown of llama.cpp to prove that this is where most of *its* time goes. A short profile on tritus would settle it.

### It reads in big batches

On this chip, the slow part isn't the arithmetic — it's fetching the weights from memory. So the trick is to fetch each weight once and use it for as many tokens as possible.

gufo pushes **2,048 tokens** through each layer at a time; llama.cpp on tritus does 512. Four times the reuse for every fetch. And gufo keeps the graphics chip (**GPU**) busy almost the whole time: its profile shows 1,363 ms of work in a 1,380 ms prompt-reading step. Practically no waiting around.

### It uses the chip's maths units directly

The GPU has dedicated circuits for multiplying grids of numbers, called **matrix units** (AMD's programming interface for them is **WMMA**). gufo writes its own code for them and hits 30–34 trillion operations a second (**TFLOPS**), against a measured ceiling of 59.

Interestingly, it tried AMD's own ready-made maths library, **hipBLASLt**, for the same job — and dropped it. It only managed 19–26 TFLOPS.

### It doesn't slow down as the conversation grows

The model's other layers don't read everything: a small scoring step picks out the parts of the conversation worth paying attention to. This is called **sparse attention**, and this model's version is called **QSA**.

gufo implements that scoring step efficiently, which is why its speed stays almost flat — 1,266 tokens a second at 32,000 tokens, 1,228 at 120,000 — while llama.cpp's drops from 303 to 176. That suggests llama.cpp's version of this step copes worse as the conversation gets longer, but again, I haven't looked inside llama.cpp to confirm it.

### It only keeps speed-ups that change nothing

This one is worth dwelling on. gufo's experiment log only accepts an optimisation if the model's output stays **bit-identical** — exactly the same, to the last digit. It's full of faster ideas that were thrown out because they changed the results, even slightly.

## What it costs

None of this comes free.

**Every new quantisation is real work.** Each way of storing the weights needs its own unpacking code inside those carefully tuned routines. So a new quantisation isn't a config change — it's more engineering. And picking gufo picks your files for you: for this model, it's UD-Q4_K_XL or nothing.

**A new model gets a head start, not a free ride.** The batching, the matrix-unit building blocks, the conversation saving and the server all carry over — gufo already covers several models, including Qwen3.8 27B and Flash-Next, DeepSeek V4 Flash, MiniMax H3, and some image and speech models. But every new kind of layer, or even a new layer size, needs its own tuning. In practice: when a new model comes out, llama.cpp usually runs it within days, slowly; gufo runs it fast, once someone has done the work.

**Some of the lead is temporary.** Reading the shortcut layers in parallel is a choice of method, not chip tuning — and llama.cpp already has that code waiting in the wings. When it lands, a big chunk of the gap should close. The chip- and model-specific parts won't. That's the moment to re-test llama.cpp on tritus.

**The young parts aren't in the maths.** gufo's number-crunching is beautifully tuned. The part that turns the model's text into structured tool calls for the agent is newer — and that's exactly where my long agent runs found a bug. Occasionally, when the model writes an edit with line breaks inside it, gufo hands the tool call back as plain text, and the agent thinks the job is done and stops. It happens roughly once every 500 turns: invisible in a speed test, but in hours of agent work it cuts stories off halfway. I've reported it as [gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304), and my test harness now nudges the agent to carry on when it happens.

## The irony

Here's the funny thing. llama.cpp started life in March 2023 as *exactly this*: one person porting one model — Meta's original LLaMA — to plain C/C++, so it could run without PyTorch's heavy machinery. It was fast because it was narrow.

Its success made it everyone's engine. And supporting every model on every chip is precisely what now leaves it lagging on this new chip and this new model.

gufo is running the same play, one level down. If it takes off, the same pressure to generalise will come knocking.

## Sources

- Speed measurements: test A on tritus, in `benchmarks/gufo-eval/results/` (runs of 27 September 2026).
- gufo's timing breakdown and experiment log: `docs/models/qwen3.8-flash-next/EXPERIMENTS.md` in [gufo-org/gufo](https://github.com/gufo-org/gufo) at `b722a61`.
- Compaction times and replays of real agent requests: [the long-session investigation](../../../../../../../docs/20260928-gufo-long-session-investigation.md).
- Why llama.cpp is slow at this on Strix Halo: [the Strix Halo + llama.cpp findings](../../../../../../../docs/20260927-strix-halo-llamacpp-findings.md).
