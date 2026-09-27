# gufo on long agent sessions: where the time goes

28 Sep 2026, overnight on tritus (Ryzen AI MAX+ 395, Radeon 8060S, 128 GB). Qwen3.8 Flash-Next, the
pi agent, the vidi canvas benchmark. Data, scripts and a timestamped log are in
`benchmarks/gufo-eval/results/20260928-long-session/` on tritus; the tools are in
[`benchmarks/gufo-eval/long-session/`](../benchmarks/gufo-eval/long-session/).

**Status: IN PROGRESS.** Sections marked _pending_ are filled in as the experiments finish.

## The question

In gufo's first agent run on tritus (canvas-gufo-01, vidi story 5), the engine looked fast by every
measure (decode 45.7 tok/s median, draft acceptance 76%, time to first token 0.6 s, prompt reading
~1,230 tok/s) yet after 73 minutes the agent had written 2 of 7 tasks and produced ~158k output
tokens, while llama.cpp (canvas-vk-01) finished the same story in 80 minutes with 102k. Why, and is
it gufo?

## Findings so far

### H3: gufo slows down over a long session — refuted

gufo's own request log for the whole session (227 requests, 19:10–20:33Z, file
`gufo-story5-server.log`), in six equal slices:

| From (UTC) | Median context | Median generated | Decode tok/s | New tokens read (median) | Time to first token | Draft acceptance |
|---|---|---|---|---|---|---|
| 19:10 | 69k | 284 | 45.9 | 299 | 0.7 s | 75% |
| 19:39 | 40k | 421 | 47.0 | 28 | 0.4 s | 78% |
| 19:50 | 74k | 432 | 49.2 | 28 | 0.5 s | 80% |
| 20:00 | 96k | 224 | 43.7 | 49 | 0.6 s | 74% |
| 20:05 | 55k | 373 | 44.7 | 373 | 1.1 s | 74% |
| 20:19 | 90k | 456 | 43.8 | 435 | 0.9 s | 75% |

Cache hits 222 of 227; server memory steady (rss 1.7–3.6 GB, ~31–33 GB host memory available).
Nothing degrades with session length or context. The engine's time goes into generating: it was
busy 73 of the 75 minutes measured, 67 of them generating.

### H2: the comparison was not like for like — confirmed (a confound, not a gufo effect)

This run builds in **user-journey order** (the user's choice), so its story 5 is the first story on
an **empty repository**. The agent's own planning says so: _"The repo is empty except README and
spec. I need to build: Foundation (stories 1-4, needed for story 5 to make sense) …"_. llama.cpp's
story 5 was built on four finished stories. The comparable llama.cpp story is story 1, the first on
an empty repository.

From the recorded agent events (`h2_events.py`, thinking characters are the model's reasoning text;
tool-argument characters are mostly files written):

| Story | Thinking chars | Turns with >20k thinking | Tool-argument chars |
|---|---|---|---|
| gufo, canvas-gufo-01 story 5 (first story; at 86 min) | 786k | 8 | 515k |
| llama.cpp, canvas-vk-01 story 1 (first story; 78 min) | 492k | 6 | 320k |
| llama.cpp, canvas-vk-01 story 5 (after 1–4; 80 min) | 307k | 0 | 379k |
| llama.cpp, canvas-vk-02 story 5 (after 1–4; 66 min, capped later) | 195k | 0 | 311k |

The eight >20k-character thinking turns are all planning the whole project from scratch (40–50k
characters each; the four largest took 5–6 minutes to generate). llama.cpp's first story has the
same shape. gufo's first story is larger still, but it is also doing more: story 5's own work plus
the foundation of stories 1–4.

Per turn, gufo was not slower: 225 assistant turns in 86 minutes, against llama.cpp story 1's 116
in 78.

### H4: gufo's known bugs

Open issues on [gufo-org/gufo](https://github.com/gufo-org/gufo/issues) relevant to long agent
sessions (checked 27 Sep):

- [#273](https://github.com/gufo-org/gufo/issues/273) agent turns can end reasoning-only (no content,
  no tool call) with thinking on at long context (reported at 75k+ tokens with ~30 tools, effort
  xhigh; workaround reasoning off). **Not seen here:** 0 reasoning-only turns in 225 (llama.cpp
  runs also 0), at contexts up to 112k (`h4_reasoning_only.py`).
- [#291](https://github.com/gufo-org/gufo/issues/291) Qwen prompt tokenisation quadratic in turns
  (closed 27 Sep, after our build b722a61). Time to first token stayed 0.4–1.1 s at 100+ turns, so
  not a visible cost here.
- [#278](https://github.com/gufo-org/gufo/issues/278) a lost GPU context returns HTTP 200 and the
  server keeps running; [#275](https://github.com/gufo-org/gufo/issues/275) disk-cache retention;
  [#272](https://github.com/gufo-org/gufo/issues/272) GPU busy at idle; [#277](https://github.com/gufo-org/gufo/issues/277)
  sampling defaults. None observed as a cause here.

### H1: which reasoning effort gufo applies — _pending_

pi sends no `reasoning_effort` on any stack (`supportsReasoningEffort: false` in the harness). The
gufo server is started with `--reasoning-effort low`; gufo's docs say a request with no reasoning
field gets "the server's compiled model defaults", and Flash-Next's compiled default is xhigh.

### H5: the same requests on each engine — _pending_

### H6: gufo settings (draft depth, prior reasoning) — _pending_

## Why published gufo results look great and ours looked bad — _pending_

## Recommended configuration — _pending_

## Decisions needed — _pending_

## Caveats

- One gufo story so far. Agent runs vary a lot between runs of the same stack.
- gufo runs UD-Q4_K_XL (111 GB); llama.cpp runs UD-IQ4_XS (94 GB). Different weights.
