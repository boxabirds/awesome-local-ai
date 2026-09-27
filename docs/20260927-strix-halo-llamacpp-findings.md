# Strix Halo + llama.cpp: good code, crippled by prefill

27 Sep 2026. Qwen3.8 Flash-Next on an AMD Ryzen AI MAX+ 395 (Radeon 8060S, 128 GB), llama.cpp
Vulkan, the pi agent, the vidi canvas benchmark (12 stories, 75 held-out browser tests). What the
runs so far show, from their records in
[`combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/benchmarks/vidi/`](../combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi/benchmarks/vidi/).

**In one line:** the model writes respectable code on this machine, but llama.cpp reads prompts at
170–350 tokens a second, so every long session spends much of its time waiting, and stories run out
of time before they run out of ideas. We are not running more llama.cpp series on this machine.

## Quality: respectable

| Run | Held-out tests passed (of 75) | Agent time |
|---|---|---|
| Flash-Next, **Strix Halo, llama.cpp** (canvas-vk-01) | **67** | 25.4 h |
| Flash-Next, Strix Halo, llama.cpp (canvas-vk-02, stopped after story 4) | 26 of 31 so far | 11.1 h for 4 stories |
| Qwen3.8 27B, RTX 4090, llama.cpp (canvas-pi-02 / -03 / -04) | 62 / 46 / 69 | 11.5–19.4 h |
| Claude Opus 5.5 reference (run-2 / run-3) | 71 / 74 | ~3 h |

- canvas-vk-01 is the second-best local run so far, within 4–7 tests of the Opus reference.
- Ten of its eleven stories were finished by the agent; the harness ended one (story 10) after five
  nudges without a commit, at 3 h 59 min.
- The held-out score is a count of passed tests, not a full quality judgement: human review of each
  story's recorded walkthroughs is under way. The agent's own test suite was rarely fully green
  (typically one failing component test and a non-zero end-to-end run per story), so its own
  checks are weaker than its product.

## Speed: prefill is the problem

**Prompt reading (prefill) on this machine**, measured in
[test A](20260926-gufo-vs-llamacpp-eval-plan.md) on the same weights for both engines (UD-Q4_K_XL,
one request at a time, every prompt read from scratch):

| Context | llama.cpp (Vulkan) | gufo (ROCm) |
|---|---|---|
| 2k | 351 tok/s | 744 tok/s |
| 32k | 302 tok/s | 1,266 tok/s |
| 64k | 237 tok/s | 1,242 tok/s |
| 120k | **172 tok/s** (≈11.5 min before the first token) | 1,228 tok/s (≈98 s) |

For comparison, from the benchmark runs' own server logs (prompt reading from scratch, median):
the same model on an M5 Max with mlx-serve reads **1,290–1,420 tok/s** at 24–140k; Qwen3.8 27B on
an RTX 4090 with llama.cpp reads **1,870–2,220 tok/s**.

**What it costs in the runs:**

- **Compaction takes minutes.** When the context fills, the agent summarises and starts over, and
  the server reads the conversation again. On this machine that took a median of **6–8 minutes**
  (30 compactions across both runs, worst about 9); on the M5 Max, **75 seconds** (median of 7).
  Each story compacts 1–5 times.
- **Stories hit the 4-hour cap.** Generation is also modest (about 50 tok/s at short context, 23 at
  120k), and with reading this slow, hard stories don't fit: canvas-vk-02's stories 3 and 4 ended at
  the 4-hour cap with their work unfinished. In canvas-vk-01 the same two stories finished, in 3.5 and
  2.6 hours.
- **A run takes a day.** canvas-vk-01 needed 25.4 hours of agent time for 11 stories.

## Why: llama.cpp, not the chip

- **Our numbers are what this llama.cpp gets on this chip.** gufo's published benchmark of llama.cpp
  at the same commit we run (`6fcaa16`, the `qwen4exp/mtp` branch) on the same chip reports 469 tok/s
  empty, 278 at 32k and 135 at 128k ([gufo BENCHMARKS](https://github.com/gufo-org/gufo/blob/main/docs/models/qwen3.8-flash-next/BENCHMARKS.md)).
  Ours are the same or slightly better.
- **The chip can do four times better:** gufo reads the same weights at about 1,230–1,270 tok/s
  from 32k to 120k on this machine (table above).
- **The likely cause**, from the llama.cpp issue tracker (not verified by us): the model's
  linear-attention (Gated DeltaNet) layers are processed token by token during prefill. A chunked
  kernel exists for Vulkan ([#20377](https://github.com/ggml-org/llama.cpp/pull/20377)) and for ROCm
  ([#29353](https://github.com/ggml-org/llama.cpp/pull/29353)) but is unmerged or switched off. That
  matches what we see: the GPU is busy, the CPU idle, and speed falls steadily with context.
- **Tuning won't close the gap.** Settings reported to help (IOMMU off, a newer Mesa, GPU clock
  pinned high, which ours already is) are worth tens of percent, not the 4× the chip allows. Larger
  micro-batches reportedly make Vulkan prefill worse at depth.

## What next

- **gufo on the same benchmark.** Test A settles speed: gufo reads prompts about four times faster
  and generates faster at long context. Whether its code is as good is the open question, and the
  only one that matters; a gufo combination for this machine is being set up to run the same stories.
- **llama.cpp runs on this machine are stopped** until the chunked prefill lands upstream.
  canvas-vk-01 (complete) and canvas-vk-02 (stories 1–4) stay as the llama.cpp reference.

## Caveats

- One complete llama.cpp run (canvas-vk-01) and one partial. Scores on this benchmark vary a lot
  between runs of the same stack (the 27B on the 4090 scored 46 to 69), so 67 is one data point.
- The test A figures are for one request at a time with no prompt reuse. Agent sessions reuse the
  cached prompt between turns, so they pay full prefill mostly after a compaction or a restart.
- The M5 Max and RTX 4090 figures come from real agent runs, not test A. The 4090 runs a different,
  dense model (27B), so that column shows what that machine delivers for its own stack, not a
  same-model comparison.
- The held-out suite and the vidi v1 spec have known issues (stories not in user-journey order; a
  contradiction audit is pending). They affect every stack alike, but not always equally.
