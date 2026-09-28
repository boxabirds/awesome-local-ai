# gufo on long agent sessions: where the time goes

28 Sep 2026, overnight on tritus (Ryzen AI MAX+ 395, Radeon 8060S, 128 GB). Qwen3.8 Flash-Next, the
pi agent, the vidi canvas benchmark. Data, scripts and a timestamped log are in
`benchmarks/gufo-eval/results/20260928-long-session/` on tritus; the tools are in
[`benchmarks/gufo-eval/long-session/`](../benchmarks/gufo-eval/long-session/).

**Status:** complete (28 Sep, 07:15 BST). tritus left idle, no servers or containers running.

## In short

- **gufo is not slow and does not degrade over long sessions.** On the same real agent requests it
  reads prompts 3–5× faster than llama.cpp and decodes ~1.7× faster at 100k context, with
  replies of the same length and valid tool calls (H3, H5).
- **The story-5 "regression" was mostly a bad comparison.** gufo's story 5 was the first story
  on an empty repository (journey order); llama.cpp's story 5 was built on four finished
  stories (H2).
- **gufo has one real, rare, fatal bug here:** when the model writes a multi-line `edit` with raw
  line breaks inside its JSON argument, gufo can't parse the call and returns it to the agent as
  plain text. The agent reads that as "finished". Seen **4 times in ~790 gufo turns** (0 in ~4,400
  llama.cpp turns). Once it ended a story with the build broken (canvas-gufo-exp1 story 1, 17 min);
  when the harness happened to nudge the agent on, it cost nothing (H7, source-confirmed).
- **When nothing goes wrong, gufo's code is good:** a second run of the same two stories
  (canvas-gufo-exp2) scored **6/6 and 20/20**, against llama.cpp's 6/6, 17/20 and 5/6, 17/20.
- **Reasoning effort is fine** (low, as configured) and neither draft depth nor quant explains
  anything (H1, H5, H6).

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

**Story 5 final (gufo):** DONE at 108 min of agent time, 294 calls, 215k output tokens, 3
compactions, held-out 3/5, gate red (`canvas-gufo-01/metrics.json`). llama.cpp's first story on an
empty repository took 78 min (116 calls, 117k output, 1 compaction, 6/6 on that story's tests) — a
different story, so this is context, not a score comparison.

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

### H1: gufo serves xhigh when the request names no effort — refuted

pi sends no `reasoning_effort` on any stack (`supportsReasoningEffort: false` in the harness). One
hard prompt (how Yjs edits merge after 30 s offline), agents' sampler, 6,000-token limit, 3 repeats
each (`effort_probe.py`, `effort.jsonl`):

| Engine | Request says | Reasoning chars (3 repeats) | Tokens out |
|---|---|---|---|
| gufo (`--reasoning-effort low`) | nothing (as pi sends) | 6,548 / 3,563 / 6,031 | 3,587 / 3,135 / 3,057 |
| gufo | `reasoning_effort: low` | 4,596 / 10,792 / 7,176 | 2,806 / 4,869 / 2,993 |
| gufo | `chat_template_kwargs: low` | 2,973 / 4,602 / 9,786 | 2,531 / 2,480 / 3,534 |
| gufo | `reasoning_effort: xhigh` | 26,864 / 27,417 / 27,039 | 6,000 ×3 (hit the limit) |
| llama.cpp | nothing | 6,337 / 8,085 / 6,446 | 2,788 / 3,566 / 2,608 |
| llama.cpp | `reasoning_effort: low` | 6,731 / 5,647 / 2,726 | 2,920 / 3,341 / 1,856 |

A request with no effort gets **low** on gufo, like llama.cpp: the same length as an explicit "low",
a quarter of xhigh, and a different opening (xhigh starts "We need answer user…", low with "The user
is asking…"). Our gufo server's `--reasoning-effort low` is honoured.

### H5: the same real agent requests on each engine — gufo is not wordier, and it is faster

Real requests taken from the gufo session (pi's system prompt, 4 tools, full history with prior
reasoning) at ~60k and ~100k tokens of context, replayed unchanged to each engine, 3 times each,
server-default sampling as in the runs (`replay.py`, `replay.jsonl`). The first repeat reads the
whole prompt; the next two reuse the cached prompt, as an agent turn does.

| Engine, weights | Context | First token (cold) | Tokens out (3 repeats, median) | Decode, warm (tok/s) |
|---|---|---|---|---|
| **gufo**, UD-Q4_K_XL | 60k | **47 s** | 255 / 136 / 300 (255) | 39–52 |
| llama.cpp, UD-IQ4_XS (as benchmarked) | 60k | 229 s | 127 / 135 / 539 (135) | 27–37 |
| llama.cpp, UD-Q4_K_XL (gufo's weights) | 60k | 230 s | 339 / 283 / 289 (289) | 27–32 |
| **gufo**, UD-Q4_K_XL | 100k | **80 s** | 894 / 1,719 / 606 (894) | 36–38 |
| llama.cpp, UD-IQ4_XS | 100k | 245 s | 1,095 / 2,598 / 1,763 (1,763) | 20–22 |
| llama.cpp, UD-Q4_K_XL | 100k | 248 s | 1,565 / 1,341 / 1,745 (1,565) | 21–22 |

- **Output length:** the same order on every engine. gufo's replies were, if anything, shorter
  (median 894 tokens at 100k, against 1,565–1,763). Nothing here makes gufo's agent wordier.
- **Speed:** gufo reads a cold prompt ~3–5× faster and, at 100k, decodes ~1.7× faster than
  llama.cpp on either quant (36–38 against 20–22 tok/s).
- **Quality of the turn:** all 36 replies ended in a `bash` tool call with valid JSON arguments,
  on every engine. No reasoning-only turns, no malformed calls.
- **Weights:** llama.cpp on UD-Q4_K_XL behaved like llama.cpp on UD-IQ4_XS; the quant difference
  between the stacks does not explain anything seen here.

### H6: gufo settings — draft depth doesn't matter; prior reasoning costs ~20% of the context

| gufo variant | Context sent as | First token (cold, 100k) | Tokens out at 100k (median) | Decode, warm |
|---|---|---|---|---|
| default (draft 7, preserve auto) | 99,633 | 80 s | 894 | 36–38 |
| `--draft-tokens 4` (llama.cpp's depth) | 99,633 | 79 s | 2,084 | 36 |
| `--preserve-thinking off` | **76,094** | **60 s** | 2,111 | 37 |

- Draft depth 4 vs 7: no speed difference.
- `--preserve-thinking off` drops earlier turns' reasoning from the prompt: the 100k request becomes
  76k (−24%), the 60k one 47k (−20%). An agent would then fill its context and compact about a
  fifth less often. It changes what the model sees (Qwen's own template keeps prior reasoning, and
  llama.cpp keeps it too: its prompt was the same 99.6k), so it is a behaviour change to test on
  real stories, not a free speed-up.
- Output lengths vary a lot between repeats at 100k (606–3,221 tokens) on every setting, so these
  three repeats can't rank the variants on verbosity.

### H7: the same stories as llama.cpp (stories 1–2, number order) — gufo scored 0, for two reasons, one of them gufo's

Run `canvas-gufo-exp1` (gufo, default config, stories 1 and 2 on an empty repository, exactly as
llama.cpp's canvas-vk-01/-02 built them):

| Run | Story 1 | Story 2 | Held-out, cumulative |
|---|---|---|---|
| gufo, canvas-gufo-exp1 | 17 min, 42 calls, 41k out, **ended early** | 59 min, 172 calls, 125k out | **0/6, 0/20** |
| llama.cpp, canvas-vk-01 | 78 min, 116 calls, 117k out | 98 min, 250 calls, 137k out | 6/6, 17/20 |
| llama.cpp, canvas-vk-02 | 75 min, 109 calls, 110k out | 112 min, 157 calls, 136k out | 5/6, 17/20 |

Two separate causes, found by reading the records:

1. **gufo returned a tool call as text, and the agent stopped (gufo bug).** Story 1's last assistant
   message is a complete, well-formed Qwen tool call (`<tool_call><function=edit>…`) delivered as
   plain text with `finish_reason: stop` and no structured call (`leak-text.txt`). pi reads a text
   reply with no tool call as "done", so the story ended after 17 minutes with only the camera maths
   built (no zoom controls, no hint). The call's `edits` argument is a JSON array whose strings
   contain raw line breaks, which strict JSON rejects; gufo's PR
   [#284](https://github.com/gufo-org/gufo/pull/284) (in our build) says a non-string value that
   still fails to parse is "rejected as before", and before #284 a rejected call was dropped
   invisibly. Across every Strix Halo run: **1 such reply in ~510 gufo turns, 0 in ~4,400
   llama.cpp turns** (`leaked_toolcalls.py`). Rare, but each one ends a story outright.
2. **The held-out suite could not start the app — an app defect, not a harness problem.** Every
   held-out test (6 in story 1, 20 in story 2) failed with `net::ERR_CONNECTION_REFUSED` at
   127.0.0.1:18787: the suite serves the app with `npx wrangler dev --port 18787` (as
   `packs/vidi/acceptance/tests/app-server.ts` does, which doesn't keep wrangler's output). Run
   the same way on the recorded workspace (built, then `wrangler dev`), wrangler refuses to start:
   _"Cannot use assets with a binding in an assets-only Worker. Please remove the asset binding
   from your configuration file, or provide a Worker script (`main`)."_
   - **The spec says otherwise:** story 1's tasks.md asks for `wrangler.jsonc` with
     `assets.directory = dist/client` (Worker `main` arrives in story 3) and e2e tests whose
     `webServer` is `wrangler dev`. The agent added `"binding": "ASSETS"` in story 1 (commit
     `85b0698`), which the spec doesn't ask for and which makes an assets-only Worker invalid.
   - **The agent then hid it from itself:** in story 2 it switched its own e2e server from
     `wrangler dev` to `vite preview` (commit `7274b95`, noting the design's wrangler flag "no
     longer exists"), so its gate went green while the app no longer started the way the spec and
     the held-out suite run it.
   - The llama.cpp runs' story 1 passed the same held-out tests (6/6, 5/6), so the suite starts a
     spec-conforming app; this is the agent's deviation, and these 0s are "the app doesn't start",
     not measured behaviour. They are **not** a measure of gufo's code quality either way.
   - A diagnostic re-score with the binding removed (not recorded) started the app but still
     scored 0/20: story 1's user interface was never built, because of cause 1.
   - **Story 1 also failed its own typecheck** (`BoardViewport.tsx: Cannot find namespace 'JSX'`).
     That is exactly the error the leaked `edit` was fixing (it adds `type JSX` to the React
     import): the fix was written, gufo returned it as text, and the story ended with the build
     broken.

### The leak, at source level (gufo b722a61)

`ParseQwenCalls` in `src/cli/serve/openai_chat.cpp` parses each `<parameter=…>` value. When the
tool's schema says the parameter is not a string (pi's `edit` tool declares `edits` as an array),
the value must parse as strict JSON (`TryParseJson`, with a Python-literal retry). gufo's JSON parser
rejects raw control characters inside strings (`src/core/json.hpp`: "unescaped control
character"). The model sometimes writes multi-line `oldText`/`newText` with literal line breaks
instead of `\n`; the value then fails, the call is marked invalid, and — as for any unparsed call —
its text is returned as ordinary content with `finish_reason: stop` and no error. pi treats a
reply without a tool call as the end of the turn, and the harness takes the session as finished.

Replaying the exact request that produced it 8 times on gufo and 8 times on llama.cpp (same
UD-Q4_K_XL weights) gave 16 valid tool calls and no leak (`leak-repro.jsonl`): the trigger is a
particular sampled output, not the request. Whether llama.cpp would accept such a value if the
model produced it there is **not measured** (no leak in ~4,400 llama.cpp turns, but also no
evidence the model wrote raw line breaks there).

## Why gufo looks great in published results and looked bad here

- **Published results measure one request at a time.** gufo's benchmarks (and our test A) time
  prompt reading and generation on single requests. On those, gufo is genuinely excellent here
  too: ~1,230 tok/s prompt reading at 32–120k against llama.cpp's 170–300.
- **An agent session is hundreds of turns of tool calls.** A benchmark of single requests never
  exercises the tool-call parser on hundreds of long, multi-line `edit` calls. A failure that
  happens once in ~500 turns is invisible there, and ends a 2-hour agent story here. That, not
  speed or long-context degradation, is the long-session stress you suspected.
- **Our first comparison was also unfair to gufo:** its "slow" story 5 was the whole project's
  foundation on an empty repository, compared with llama.cpp's story 5 on top of four finished
  stories.
- **The agent's own mistakes land on whichever engine is running.** canvas-gufo-exp1's app didn't
  start under `wrangler dev` because the agent added a config line the spec doesn't ask for;
  llama.cpp's runs happened not to. One such mistake zeroes a run's held-out score, so single
  runs say little about an engine's code quality either way.

## Recommended configuration

- **Engine: gufo** for long agent sessions on tritus, with its current settings (effort low,
  thinking on, the agents' sampler, draft depth 7 — depth 4 was no faster). It is several times
  faster where agent sessions spend their waiting time (prompt reading after a compaction or a
  cache miss) and no less careful per turn.
- **But not without a guard for the tool-call leak.** Until gufo accepts (or repairs) such values,
  a leaked call silently ends a story. Two options, both now in place:
  1. In the harness: treat a final assistant message containing `<tool_call>` markup as an
     interrupted turn, and continue the session (as it already does after an error), recording it
     as an intervention. Cheap, engine-independent, visible in the records. **Built** (b05c5972,
     `toolcall_text_resumes` in the run records; up to 3 resumes per story).
  2. Upstream: reported as [gufo#304](https://github.com/gufo-org/gufo/issues/304) — with the leaked text and the parser path above (a string value
     inside a JSON-typed parameter, with raw line breaks, could be repaired by escaping control
     characters before parsing, as lenient JSON parsers do).
- **`--preserve-thinking off`** cuts the prompt by 20–24% and would reduce compactions, but
  changes what the model sees; test it on real stories before adopting it.
- **llama.cpp on tritus stays stopped** (prefill 170–350 tok/s; see
  [the findings](20260927-strix-halo-llamacpp-findings.md)).

## Decisions needed

1. ~~Build the harness guard (option 1 above) before any further gufo runs?~~ Done: b05c5972.
2. ~~Report the parser issue upstream to gufo~~ Done: filed as [gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304) (28 Sep 2026), with a parser-level reproduction and a proposed patch.
3. Keep gufo runs in journey order (story 5 first, as canvas-gufo-01) or number order (as the
   other stacks, like canvas-gufo-exp1/-exp2)? Only number order compares per story.
4. The held-out suite gives 0 to an app that doesn't start under `wrangler dev`, whatever it does.
   That is correct per the spec, but it makes one config mistake worth a whole run; worth
   recording "app did not start" as its own outcome in the summaries so it isn't read as
   "every feature broken".

### H7b: a second like-for-like run (canvas-gufo-exp2) — 20/20

| Run | Story 1 | Story 2 | Held-out, cumulative | Leaked tool calls |
|---|---|---|---|---|
| gufo, canvas-gufo-exp2 | 34 min, 95 calls, 78k out | 94 min, 184 calls, 195k out, 3 nudges | **6/6, 20/20** | 1 (story 1), 2 (story 2) |
| gufo, canvas-gufo-exp1 | 17 min, ended by a leak | 59 min | 0/6, 0/20 (app didn't start) | 1 (story 1) |
| llama.cpp, canvas-vk-01 | 78 min | 98 min | 6/6, 17/20 | 0 |
| llama.cpp, canvas-vk-02 | 75 min | 112 min | 5/6, 17/20 | 0 |

- **gufo's best case beats llama.cpp's** on the same stories and in less time on story 1.
- **The leaks are not rare enough to ignore:** 4 in ~790 gufo turns across the night. In exp2's
  story 2 the harness answered two of them with its "stopped without committing" nudge
  (`dbench logs tritus canvas-gufo-exp2`), which continued the session and cost little. In exp1's
  story 1 the leak came after commits, so no nudge fired and the story simply ended. Whether a leak
  costs nothing or a whole story is luck — hence the guard in the recommendations.
- Story 2 of exp2 used more output (195k) and time (94 min) than exp1's, and needed 3 nudges;
  two of those were leaks, the third an ordinary stop.

## Caveats

- Few gufo stories so far (canvas-gufo-01 story 5; canvas-gufo-exp1 and -exp2, stories 1–2).
  Agent runs vary a lot between runs of the same stack.
- Replays use three repeats per request; enough to compare speed and order of magnitude of output,
  not to rank verbosity finely.
- gufo runs UD-Q4_K_XL (111 GB); llama.cpp runs UD-IQ4_XS (94 GB). Different weights.
