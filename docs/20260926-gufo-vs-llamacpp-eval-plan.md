# gufo vs llama.cpp on Strix Halo: the test plan, written before any results

26 Sep 2026. This plan is published **before** any gufo results exist, so the method can't be
fitted to the outcome. Comments on the configuration are welcome before the run, especially from
gufo's developers and users. If something here is unfair to either engine, say so, and it will be
changed and noted here with the date.

## The question

Is gufo a better engine than llama.cpp for **one agentic coding session** on a Strix Halo 128 GB
machine running Qwen3.8 Flash-Next? A session like that means long context (70–130k tokens), many
tool calls, thinking on, and sampling at temperature 1.0.

gufo's own benchmarks show large prefill and multi-user gains. This plan tests the single-user
agent case, which its benchmarks don't cover directly.

## The machine (fixed for every test)

| | |
|---|---|
| Machine | Minisforum MS-S1 MAX: Ryzen AI MAX+ 395, Radeon 8060S (gfx1151), 128 GB |
| OS | Ubuntu 26.04, kernel 7.0.0-34 |
| GPU clock | `power_dpm_force_performance_level` = high; BIOS power mode Performance |
| Isolation | nothing else on the GPU during a test; the agent benchmark paused |

## The engines

| | gufo | llama.cpp |
|---|---|---|
| Version | **a build that contains [#284](https://github.com/gufo-org/gufo/pull/284)** (merge `b722a61`, tool-argument whitespace fix): the first published runtime image after it, or a source build at or after it. The current image (`d9a84f1`) predates the fix and will not be used. | `danielhanchen/llama.cpp` branch `qwen4exp/mtp`, commit `6fcaa16` (the MTP branch; the same commit gufo's own benchmarks use as their MTP baseline) |
| Backend | ROCm/HIP, as shipped in gufo's runtime image | Vulkan (measured faster than ROCm on this machine); ROCm is reported too |
| Speculation | `--speculative mtp`, gufo's adaptive policy, its default draft cap | MTP, `--spec-draft-n-max 4`, `--spec-draft-p-min 0.0` |

## The model

Qwen3.8 Flash-Next, Unsloth GGUF at revision `38bb39ee97821de2c9009abb7e93950eec396e66` (the
revision gufo's docs pin), with the shared-Q8_0 MTP head.
- **Main comparison, same weights on both:** `UD-Q4_K_XL`, the only quant gufo supports.
- **Reference:** llama.cpp on `UD-IQ4_XS`, the quant this repo's benchmark runs use. This shows
  what the smaller quant costs or saves. It is not used to judge gufo.

## Settings both engines get

| Setting | Value | Why |
|---|---|---|
| Context capacity | 131,072 tokens, 1 session | what the agent benchmark uses |
| Sampling (agent tests) | temperature 1.0, top-p 0.95, top-k 20, min-p 0 | the model's recommended thinking settings; gufo defaults to greedy, so it gets these explicitly |
| Sampling (throughput tests) | greedy (temperature 0) | the setting gufo's published numbers use, so results can be checked against them |
| Reasoning | thinking on, effort `low`, prior reasoning preserved | what the agent benchmark uses |
| Prefix reuse | gufo: its default, plus `--cache-disk` if its developers recommend it for this workload ([#259](https://github.com/gufo-org/gufo/issues/259)); llama.cpp: `--ctx-checkpoints 8` | each engine's own prompt-cache mechanism, on |

## The tests

**A. Throughput.**
- **Prompts:** code from this repo, at 2k, 32k, 65k and 120k tokens of context.
- **Measure:** prefill tok/s, decode tok/s over 400 generated tokens, and MTP acceptance; plus peak GPU memory.
- **Repeats:** 3 at each depth; report the median.
- **Script:** the same one used for this repo's earlier TurboQuant test (`turbo-kv.sh`), extended to start gufo.

**B. A scripted multi-turn agent session** (thinking on, temperature 1.0). A fixed sequence of 40
turns replays a real benchmark session's tool-call pattern (read, edit, bash) and grows the context
from about 5k to 120k tokens. For each turn:
- **Tool calls:** whether the call parses, with arguments byte-for-byte correct. This checks [#266](https://github.com/gufo-org/gufo/issues/266) and [#284](https://github.com/gufo-org/gufo/pull/284).
- **Empty turns:** reasoning with no reply and no tool call. This checks [#273](https://github.com/gufo-org/gufo/issues/273).
- **Prompt reuse:** tokens reused from the previous turn against tokens re-processed. This checks [#248](https://github.com/gufo-org/gufo/issues/248).
- **Timing and errors:** time to first token, total turn time, and any HTTP error, including 400 `invalid_prompt` ([#285](https://github.com/gufo-org/gufo/issues/285)).

**C. Real agent work.** Two vidi canvas stories: story 7 (select, move, resize) and story 8 (undo
and redo).
- **Starting point:** each starts from **the same committed code** (the same base commit and the same prompt), with the pi client.
- **Repeats:** 2 runs per engine.
- **Score:** the private held-out acceptance suite, plus agent time, output tokens and compactions.
- **Engine failures:** failed or empty requests.

**D. Stability, throughout A to C.**
- **Errors:** every HTTP error and every silent failure (an HTTP 200 with no tokens, [#278](https://github.com/gufo-org/gufo/issues/278)).
- **Health:** server restarts, and GPU resets in the kernel log.

## What counts as a win, decided now

**gufo wins on speed** if, on the same `UD-Q4_K_XL` weights, it is at least 2× faster at prefill at
32k and 120k (test A) **and** within 10% of llama.cpp on decode at 32k and 120k.

**gufo is fit for agent work** if, in test B:
- 0 malformed tool calls;
- no more than 1 empty turn in 40;
- no request refused below 131,072 tokens;
- turn 2 onwards reuses the previous turn's prompt.

**gufo is at least as good for agent work** if, in test C, its held-out score is within 1 test of
llama.cpp's on each story, averaged over the runs, and it had no failure in test D that stopped a
story.

Anything else is reported as measured, without a verdict.

## What gets published

- **Raw data:** every raw number, log and command, in this repository under `benchmarks/gufo-eval/`.
- **Configurations:** the exact image digest or commit, and every command line.
- **Results:** the results post links to this plan and states every deviation from it, with the
  reason.
- **Engine-specific failures:** any failure specific to one engine gets filed as an issue on that
  engine's repository, with the data.

## Known risks to fairness

- **One machine and a handful of runs.** Test C's story scores vary between runs on any engine.
  Opus 5.5 ranged 71–74 of 75 across three runs of the whole benchmark. Two runs per engine can show
  a large difference, not a small one.
- **Different backends.** The engines use different GPU backends (ROCm vs Vulkan) because each
  ships that way. llama.cpp's ROCm numbers are reported too.
- **gufo is six weeks old and changes daily.** The results describe the pinned build, not gufo in
  general.
