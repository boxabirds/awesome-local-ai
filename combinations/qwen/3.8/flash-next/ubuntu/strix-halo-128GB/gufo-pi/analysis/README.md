# Why the four gufo v2 runs differ so much

A forensic look at runs `v2-r1` to `v2-r4` of Qwen3.8 Flash-Next on gufo (Strix Halo, pi), 1 October 2026. The
same eleven stories took between 7.4 and 11.1 hours per run, and single stories differed by up to 7.6 times
(story 10: 27 minutes in one run, 204 in another). This note says where that comes from.

Sources: every model call and tool call in the 44 conversation logs (8,035 calls), and every request in gufo's
own server logs (8,095 requests). `v2-r5` was still running and is left out.

## Summary

1. **The engine is steady.** Decode speed per run was 45.9 to 47.8 tok/s, within 2% of each other. Draft
   acceptance, cache hits and temperatures were the same in all four runs. Nothing on the server or the machine
   explains the spread.
2. **The largest single cause is a harness fault, not the model.** In two stories the agent said the story was done
   but had not committed. The harness told it to "continue" five times. In `v2-r1` story 10 the agent then built
   stories 11 and 12 as well, for 171 more minutes. That one event is 35% of all the spread, and it makes `v2-r1`'s
   stories 10, 11 and 12 not comparable with the other runs.
3. **The largest cause that is the model's own is how much it thinks.** Thinking for the same story varied by up to
   18 times between runs (story 2: 21,000 characters in one run, 390,000 in another). It is 40% of the spread.
   A few very long thoughts carry it: 5% of calls hold 52% of all thinking.
4. **The work itself is stable.** Code written per story varied by 13% between runs, and model calls by 13%.
5. **With the harness fault taken out, run totals agree to 7%** (8.2, 7.5, 8.0 and 6.8 hours). A single story still
   varies by 23% (median), so one story from one run says little.

## What varies and what does not

How much each measure differs between the four runs of the same story (median over the 11 stories; times and
counts are up to the first "done", see finding 1):

| measure | run-to-run variation (CV) | slowest / fastest, median | worst story |
|---|---|---|---|
| decode speed of the engine, per run | 1.5% | 1.04x | |
| code written, characters | 13% | 1.4x | 4.8x |
| model calls | 13% | 1.4x | 2.4x |
| minutes | 23% | 1.8x | 5.4x |
| tokens generated | 23% | 1.7x | 3.6x |
| test runs the agent made | 28% | 2.3x | 3.8x |
| tool minutes | 41% | 3.6x | 23.9x |
| thinking, characters | 46% | 3.7x | 18.6x |

The gap between the slowest and the fastest run of each story, summed over the eleven stories, is 8.1 hours. It was
spent on:

| spent on | hours | share of the gap |
|---|---|---|
| thinking | 3.3 | 40% |
| after the agent said "done" and was nudged on | 2.9 | 35% |
| tools (tests, builds, servers) | 0.7 | 9% |
| writing code and text | 0.6 | 8% |
| compaction | 0.4 | 5% |
| reading prompts, and the rest | 0.2 | 3% |

## Findings

### 1. The harness kept two finished stories running (35% of the spread)

When the agent stops without a commit, the harness sends a nudge, up to five times, and then ends the story as
PARTIAL. Until 1 October the nudge said only to continue with the task.

| run | story | said "done" at | went on for | calls after | what it did |
|---|---|---|---|---|---|
| `v2-r1` | 10 | 32 min | 171 min | 504 | built stories 11 (pen) and 12 (images) as well, then chased failures in the whole end-to-end suite |
| `v2-r4` | 4 | 57 min | 35 min | 97 | re-ran every suite and re-stated that the story was complete, six times |

Neither agent ever committed, so both stories ended at the cap and were recorded PARTIAL. In `v2-r1` the agent's
reply at 50 minutes was "Story 10 is fully complete … Is there another story you'd like me to implement?", and its
last was "Stories 10, 11, and 12 are fully implemented."

Consequences:

- `v2-r1`'s story 10 (204 minutes) is three stories' work. Its stories 11 and 12 then started from code that was
  already there: story 11 wrote to 12 files in 23 edits, where the other runs wrote to 18–22 files in 45–54.
- Story 10's 7.6x spread becomes 2.0x when each run is counted to its first "done".
- Hours per run: 11.1, 7.5, 8.0, 7.4 as recorded (CV 18%); 8.2, 7.5, 8.0, 6.8 to the first "done" (CV 7%).

The nudge wording was changed on 1 October, after these stories, to say the work must be committed. Nothing yet
stops a nudged agent from starting the next story.

### 2. How much the model thinks (40% of the spread)

Thinking is 28% of all time in these runs (9.4 of 34 hours) and it is the least repeatable thing in them.

- **Most thoughts are short, a few are enormous.** 71% of calls think for under 300 characters. The 5% of calls
  with a thought over 3,000 characters hold 52% of all thinking; the 62 thoughts over 10,000 characters (1% of
  calls) hold 22%. The largest was 67,893 characters, in one reply of 17,201 tokens.
- **The same story is done in two styles.** In some runs the agent plans the whole story in one long thought and
  keeps reasoning at length; in others it reads, writes and tests with a line of thought per step. Story 2:

  | | `v2-r1` | `v2-r2` | `v2-r3` | `v2-r4` |
  |---|---|---|---|---|
  | minutes | 80 | 18 | 97 | 52 |
  | thinking, characters | 329k | 21k | 390k | 188k |
  | calls with a thought of 300+ characters | 60% | 13% | 62% | 59% |
  | held-out tests passing after it | 20/20 | 19/20 | 19/20 | 19/20 |

- **Long thoughts are not set off by failures.** In the cases read, the first long thought came after a clean
  result: after reading the spec ("let me plan the implementation"), or after all tests passed ("let me verify the
  remaining pieces of the design").
- **Neither a long thought nor a compaction reliably changes the style.** After a thought of 8,000+ characters the
  median thought in the next 15 calls is 1.1x the median before it (87 cases). After a compaction it is lower in 19
  of 49 cases. So an earlier explanation, that one huge thought makes everything after it longer, does not hold
  across these runs.
- **Thinking is also slower to generate.** Calls that are mostly thinking decode at 38.5 tok/s with 69% of drafts
  accepted; calls that are mostly code decode at 52.7 tok/s with 85%. A run that thinks more is slower per token as
  well as longer. This is the whole of the difference in decode speed between stories (39 to 54 tok/s).
- **Nothing limits a thought.** The runs use reasoning effort "low", which on this model is a line in the prompt
  template. gufo has no thinking budget to set. Sampling is temperature 1.0, top-p 0.95, top-k 20, with no fixed
  seed, so every run is a different sample by design.

For comparison, the same model on mlx-serve thinks about four times as much per call (median 470 characters against
105) and does so every time: its thinking varies by 14% between runs, not 59%, and its runs take 18–22 hours.
The Claude reference models vary by 4% in tokens generated per story. See "Other stacks" below.

### 3. How much the agent tests, and what it does when tests fail (9%)

- End-to-end tests are 4.0 of the 6.7 tool hours. A story's end-to-end time ran from 0 to 78 minutes.
- Some runs never ran an end-to-end test in a story: `v2-r2` in stories 10 and 12, `v2-r4` in story 10. `v2-r2`
  was the fastest run and scored lowest (58/75 against 66, 66 and 68); it lost 6 held-out tests in story 10 and 4 in
  story 12. That is suggestive, not established: `v2-r4` also skipped them in story 10 and lost none.
- In `v2-r1` story 10 the whole end-to-end suite passed with two workers and failed 16–18 tests with one, and the
  agent spent over an hour on it (inside the nudged-on time of finding 1).
- In `v2-r3` story 2 a dev server left in the background held a tool call for 10 minutes until the harness killed
  it.

### 4. Smaller effects

- **Compaction** (5%): 51 compactions, about 90 seconds each. More thinking fills the context sooner, so the long
  runs of a story also compact more (story 4: one compaction in the fastest run, three in the slowest).
- **Tool calls written as text**: gufo returned a tool call as plain text 7, 2, 1 and 1 times in the four runs. Each
  ends the agent's turn and the harness resumes the session. Minutes, not hours.
- **The published logs of `v2-r1` and `v2-r2` are cut.** They were recorded before 30 September, when long strings
  were still shortened on publication. Read from the repo, their thinking is under-counted by half or more (story
  2 of `v2-r1`: 153k characters of 329k). This analysis used the full logs from the machine for those two runs.
  The recorded conversation profiles in `metrics.json` were made from the full logs and are right.

### 5. What was ruled out

| factor | evidence |
|---|---|
| engine speed drifting | 46.7, 45.9, 47.0, 47.8 tok/s per run |
| context size slowing generation | 46.6 tok/s under 20k prompt tokens, 45.9 over 100k |
| prompt cache misses | 98.0–98.2% of requests hit the cache; 1.6–1.8% of prompt tokens re-read |
| draft acceptance changing | 79–80% in every run |
| replies cut by the output limit | none: every request ended by the model, bar two cancelled in `v2-r3` |
| heat or throttling | GPU 86–87 °C at most, no throttled sample in any story |
| memory | swap at most 1.9 GB. Free memory stayed above 21% in three runs. In `v2-r3` it fell to 3% in story 3 and under 10% in three more, with no effect on speed (47.0 tok/s, and story 3 took 39 minutes like the others) |

## Other stacks

Run-to-run variation per story, from the records in the repo (`compare_stacks.py`):

| stack | runs | minutes | tokens generated | thinking | thinking per call, median |
|---|---|---|---|---|---|
| Flash-Next, gufo | 4 | 23% | 24% | 59% | 105 chars |
| Flash-Next, mlx-serve | 2 | 18% | 16% | 14% | 470 chars |
| Swift 1.5 27B, llama.cpp | 3 | 28% | 30% | 55% | 210 chars |
| Opus 5.5 | 3 | 10% | 4% | 10% | withheld |
| Sonnet 5.5 | 2 | 15% | 4% | 11% | withheld |

The wide spread is not particular to gufo. Swift 1.5 on llama.cpp shows the same pattern. It belongs to these
models at these settings: sometimes terse, sometimes at length. The Claude models produce nearly the same number of
tokens for a story every time.

## What this means for reading the results

- A single story from a single run is not a measurement of this stack: expect ±23%, and occasionally 5x.
- Run totals are far steadier: ±7% once the nudge fault is removed. With four runs the mean is known to about ±4%.
- Engine speed and agent behaviour are different questions. The engine's speed is known to ±2% from any one run.
  How long the agent takes is a property of the model's behaviour and needs several runs.
- A cap on thinking would save time but not fix the spread. Limiting every thought to 2,000 characters would remove
  4.0 of 30.5 hours by arithmetic on these runs, and leave the per-story variation at 19%. This is arithmetic, not a
  measurement: a capped model would behave differently.

## The nudge, examined on every stack

Finding 1 led to a look at every nudge in every local stack's logs (`nudges.py`): 227 nudges in 63 story runs,
and 3,124 more in one story that looped on "Nothing left to do."

The harness nudges when the agent stops and has made no commit since the story began. Until 1 October the nudge was
one sentence: "Continue with the task from where you left off." It never read what the agent had said.

| before the nudge the agent had… | nudges | then committed | worked on, no commit | only talked |
|---|---|---|---|---|
| said the story was done | 88 | 7 | 80 | 1 |
| sent an empty reply | 87 | 17 | 41 | 29 |
| said it would go on, and stopped | 6 | 4 | 2 | 0 |
| asked a question or offered more | 2 | 1 | 0 | 1 |
| written a tool call as text | 8 | 2 | 6 | 0 |
| other | 36 | 2 | 32 | 2 |
| all | 227 | 33 (15%) | | |

- **A nudge led to a commit 15% of the time.**
- **The commonest case is a finished story that is never committed.** 80 of 88 such agents did more work and still
  did not commit. In their words: "I'd be inventing busywork to fill the turn", and "if you'd like me to … commit
  the work … or start another story, tell me which and I'll proceed".
- **The instruction is far behind them.** The story's prompt says to commit when complete, with the message to use,
  and not to ask questions. By the end that is hundreds of calls and several compactions back.
- **Questions get "continue" for an answer.** Two agents asked what to do next; one of them is `v2-r1` story 10,
  which then built the next two stories.
- **The rule has a second hole.** Any commit since the story began counts as finished, and agents commit task by
  task. An agent that stalls after an early task's commit has its story accepted. Eight v2 stories on the local
  stacks were recorded DONE with tasks the harness's own check found not started (two of them are `v2-r1`'s stories
  11 and 12, built during story 10). The other six are candidates for an early end, not confirmed ones: the task
  check looks for test-case names in the story's own commits and can miss work.

### The replacement, approved 1 October 2026

One message for every stop, the same each time, with the story's number, title and task file filled in:

```
This is an automated message from a script. Nobody reads your replies and
nobody can answer questions. You will get this same message every time you
stop, until story {n} is finished in the way described here.

You are working on story {n}, "{title}", and nothing else.
Its tasks are in {tasks_path}.

Do the first of these that applies:

1. Your last message contained a tool call written as text: it was not run.
   Make the call again as a real tool call.
2. A task in tasks.md is not finished: carry on with it now. Do not write a
   summary first.
3. Something cannot be done on this machine (for example a browser that is
   not installed): write what and why in NOTES.md and treat that task as
   finished.
4. Every task is finished: do not re-check or improve anything. Run
   git add -A && git commit -m "story {n}: {title}"
   then git rev-parse HEAD.

When the commit is made, reply with exactly this one line and stop:

STORY {n} DONE <commit hash>

Do not start any other story. Do not offer further work. Do not ask what to
do next.
```

Why each part is there:

| part | the case in the logs it answers |
|---|---|
| "a script … nobody can answer" | agents waiting for permission to commit, or asking what to do next |
| the story's number and title, "nothing else", "do not start any other story" | `v2-r1` story 10 building stories 11 and 12; an offer to start story 13 |
| branch 2, carry on | 93 nudges after an empty reply or "let me now…" |
| branch 3, cannot be done here | an agent that correctly reported browsers it could not install, and so could never say every test passed |
| branch 4, "do not re-check or improve" | finished agents re-running every suite on each nudge (35 minutes in `v2-r4` story 4) |
| the exact commit command | the commit message is in the first prompt, long gone from view |
| one fixed line with the commit hash | "the story is done" appears in ordinary summaries; a fixed line with a hash can be checked |

The harness's side of it:

- A story ends only on evidence: the reply holds the DONE line, the hash is the workspace's HEAD, and nothing is
  left uncommitted. Anything else gets the same message again. A commit alone no longer ends a story, which closes
  the second hole.
- The cap stays. After five repeats the harness commits the work itself and records the story PARTIAL.

What is not known: whether it works. The logs show only how agents answered the old sentence. The measure is the
share of stops that end in a verified commit, against 15%.

## What can be run again

Every finished v2 run on the local stacks keeps its whole workspace history (`workspace.bundle`) and the commit each
story ended on. The harness can already rebuild any story's exact starting point from those: its known-good mode
(`run.sh … --only N --from-run <run>`) runs one story on a finished run's code as it was when the story before
ended. So:

| question | answer |
|---|---|
| Can any one story of a finished run be run again from where it started? | Yes, for all nine finished v2 runs on the local stacks. |
| Will it give the same result? | No. It is a new sample: temperature 1.0, no fixed seed. It shows how the story goes from the same start, not the same story again. |
| Can a run be repaired by replacing one story? | No. The stories after it were built on the code the original story left. A replayed story leaves different code. |
| Can a run be continued from story N to the end? | Not yet. Known-good mode runs exactly one story. `v2-r1` would need stories 10, 11 and 12 in a chain. |
| Can it be queued like a normal run? | Not yet. `run.sh` takes `--from-run`; the job queue's submit command does not. |

The three v2 story runs the nudge kept going for more than five minutes after "done":

| stack | run | story | said done at | nudged on for | what to do |
|---|---|---|---|---|---|
| gufo | `v2-r1` | 10 | 32 min | 171 min | not repairable: stories 11 and 12 were built inside it. Leave the three out of per-story comparisons and let `v2-r5` be the fourth clean run. |
| mlx-serve | `v2-r2` | 4 | 200 min | 41 min | no rerun needed: count the story to its first "done". |
| gufo | `v2-r4` | 4 | 57 min | 35 min | no rerun needed: count the story to its first "done". |

Known-good mode is also what proposal D needs: story 2 five times from one run's story-1 commit.

## Thinking spread as a headline figure

How much the model's thinking for the same story differs from run to run turned out to be the largest cause that
is the model's own (40% of the spread here). It is worth a figure of its own, because it says how predictable a
stack's turnaround is, which speed alone does not.

**Thinking spread:** for each story, the variation (CV) of total thinking across the runs; then the median over
stories. It has no unit, so characters (local models) and tokens (Claude, whose thinking text is withheld) can sit
side by side.

| stack | runs | thinking spread | thinking per story, median | time spread per story | time per story, median |
|---|---|---|---|---|---|
| Flash-Next, gufo | 4 | 59% (46% to the first "done") | 80k chars | 23% | 35 min |
| Flash-Next, mlx-serve | 2 | 14% | 464k chars | 18% | 101 min |
| Swift 1.5 27B, llama.cpp | 3 | 55% | 164k chars | 28% | 35 min |
| Opus 5.5 | 3 | 10% | 23k tokens | 10% | 15 min |
| Sonnet 5.5 | 2 | 11% | 9k tokens | 15% | 11 min |

How to read it, and its limits:

- Low spread is not good on its own. The same model on mlx-serve thinks at length every time: steady, and nearly
  three times slower per story than on gufo. Show the spread beside how much is thought, never alone.
- It needs runs. With two runs the figure is provisional; three is the least to quote.
- It is a property of model, engine settings and agent together. gufo and mlx-serve run the same model and differ
  fourfold, because their reasoning settings differ.
- A harness fault can inflate it, as the nudge did here. Count thinking to the story's first "done".

## Proposed actions

A is approved and being built. The others need the owner's approval.

**A. A finished story must not keep running** (approved 1 October 2026; see "The replacement" above)

**B. Mark what is not comparable**
- **Problem:** `v2-r1` stories 10, 11 and 12 are shown beside the other runs' as if they were the same work.
- **Recommended solution:** note on those three story runs that story 10 includes the work of 11 and 12, and leave
  them out of per-story comparisons. The run's total and its score stand.
- **Proposed actions:** add the note to the run's interventions, and have comparisons skip the three.

**C. Compare stacks on what is repeatable**
- **Problem:** per-story figures from single runs vary too much to compare stacks.
- **Recommended solution:** compare run totals and per-story medians over runs, show the spread beside any
  per-story figure, and report engine speed separately from agent time.
- **Proposed actions:** a change to the comparison pages.

**D. Measure the model's own variation directly**
- **Problem:** in a full run each story starts from that run's own earlier code, so story-level variation mixes the
  model's randomness with what it built before.
- **Recommended solution:** replay one story five times from the same commit. Story 2 is the candidate (18 to 97
  minutes here). Optionally repeat with a fixed seed, to see how much is sampling.
- **Proposed actions:** about five story runs on the Strix Halo box.

**E. Thinking spread on the comparison pages**
- **Problem:** nothing shown today says how predictable a stack is.
- **Recommended solution:** show thinking spread and time spread per stack, beside the amounts, once a stack has
  three finished runs.
- **Proposed actions:** the harness or benchmarker computes both from the records; a change to the pages.

**F. Running stories again**
- **Problem:** known-good mode runs one story and can't be queued, so `v2-r1` can't be continued from story 10 and
  proposal D has to be run by hand.
- **Recommended solution:** let the job queue submit a known-good story, and let known-good mode continue to the end
  of the scope when asked.
- **Proposed actions:** tests first, then the two changes; then D.

## Reproducing this

- `analyse.py` prints every table (kept in `tables.md`) and writes `story-runs.csv`, from `data.json.gz`.
- `data.json.gz` holds, for each story run, every call, tool call, compaction and server request as numbers and
  categories. It has no conversation text, commands or paths.
- `extract.py` builds `data.json.gz` from the published conversation logs, the server logs, and for `v2-r1` and
  `v2-r2` the full logs. The server logs and full logs stay on the machine that ran the runs; `slim_full_logs.py`
  prepares the full logs there.
- `compare_stacks.py` and `nudges.py` read only the repo.

## Limits

- Four runs. Variation figures from four values are themselves rough.
- Time on thinking against code is split by characters within each call, not by a token count of each.
- "Said done" is found by wording in the agent's last reply before a nudge. It was checked by reading both cases.
- The causes of long thoughts were read in a dozen cases, not classified across all 376 thoughts over 3,000
  characters.
