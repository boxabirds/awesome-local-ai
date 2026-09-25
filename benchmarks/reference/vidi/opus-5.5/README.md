# Vidi reference: Claude Opus 5.5

A reference build of the Vidi spec's **canvas scope**: stories 1–5 and 7–12, the same 11 stories the local-model benchmark runs cover. It was built by Claude Opus 5.5 so there's a frontier-model result to compare local setups against. It was built on 24–25 Sep 2026.

## How it was built

Setup:
- **Agents:** one fresh Opus 5.5 subagent per story, in scope order. Each got **the same rendered story prompt as the benchmark agents**, produced by the harness's own template code (`prompts/`), plus a short preamble describing its environment.
- **Workspace:** it started from the same seed the harness uses, `README.md` plus a read-only copy of `spec/` in a fresh git repo. It lived outside this repository.
- **Where commands ran:** code was edited on a Mac. Every npm, build, test and server command ran on a Linux build machine (gruntus: Ubuntu 22.04, Node 24) through a sync-and-run wrapper.
- **Scoring:** the held-out acceptance suite (`benchmarks/vidi/acceptance`) ran once at the end, against all 11 stories, with `harness/gates.py accept`. That is the same scorer the benchmark runs use.

How it differs from a benchmark run:
- **Isolation by instruction, not sandbox.** Each subagent was told to read only its repository, but it wasn't sandboxed from the rest of the machine. The orchestrating session had seen the held-out suite, but gave the subagents no information about it.
- **No harness guards.** There were no nudges, resumes, loop guard or hang guard. Every story finished in one attempt, and each agent decided for itself when it was done.
- **WebKit was never run.** It can't launch on the build machine (missing system libraries), so the agents' own e2e ran in Chromium and Firefox.
- **A shared, busy build machine.** A local-model benchmark (RTX 4090) was running on the same machine at the same time. The agents saw occasional load-related flakes and port collisions in their own e2e, and they recorded these in the commit notes.

## Results

Held-out acceptance suite (`accept.json`), after the suite fix in `5756fe5`. That fix removed 7 faults in the tests themselves, found by this build's audit.

| Story | Opus 5.5 held-out |
|---|---|
| 1 Pan and zoom | 10/10 |
| 2 Sticky notes | 9/10 |
| 3 Live editing | 6/7 |
| 4 Saving | 4/4 |
| 5 Sharing | 5/5 |
| 7 Multi-select | 8/8 |
| 8 Undo/redo | 7/7 |
| 9 Free text | 6/6 |
| 10 Shapes and arrows | 8/8 |
| 11 Freehand pen | 5/5 |
| 12 Images | 5/5 (3/5 on one run: an intermittent file-chooser timeout) |
| **All** | **73/75** (three runs: 73, 72, 71) |

- **The two failures are one real bug:** Delete is ignored while a button has keyboard focus.
- **Before the suite fix** this build scored 63/75. Ten of those failures were the suite's own faults, not the app's.
- **Two full runs:** the second scored 72/75, because a story 12 file-chooser test timed out intermittently.

**Delivery audit:** [AUDIT.md](AUDIT.md) lists 4 functional faults, 0 false completion claims, 1 missing test, 2 weak tests and 10 design/process deviations. The same rubric and reviewer were applied to Flash-Next, which has 33 functional faults and 13 false claims.

**Flash-Next** (`canvas-pi-01`), scored with the same fixed suite: **60/75**. The head-to-head is in AUDIT.md.

### Efficiency: where the speed difference comes from

Opus output tokens are the final usage of each API call, summed from the subagent transcripts. Wall time covers the whole story, including tool time: builds and tests ran on another machine over ssh.

| Story | 1 | 2 | 3 | 4 | 5 | 7 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| API calls | 24 | 42 | 62 | 72 | 73 | 61 | 63 | 67 | 69 | 69 | 78 | 680 |
| Output tokens (k) | 51 | 85 | 95 | 122 | 80 | 114 | 79 | 107 | 130 | 73 | 101 | 1,038 |
| Output tok per wall-second | 108 | 102 | 72 | 57 | 70 | 82 | 51 | 75 | 97 | 39 | 56 | 68 |

Compared with the Flash-Next run over the stories both had finished:

| Stories 1–10 | Opus 5.5 | Flash-Next (MTPLX, pi) |
|---|---|---|
| Agent time | 195 min | 696 min recorded (understated, see below) |
| Model calls | 587 | 2,413 |
| Output tokens | 0.86M | 1.82M |
| Output tokens per wall-second | ~74 | ~44 |
| Held-out score (old suite, before the test fixes) | 59/65 | 50/65 |

Flash-Next's figures come from MTPLX's own request log and the run's `metrics.json`. The recorded time leaves out work before harness restarts: story 5's first 56 minutes, and two compaction-deadlock segments in story 10.

**How to read it.** The end-to-end gap (about 3.6×, more once the missing restart time is counted) has two parts:
1. **Speed per token, about 1.7×.** Flash-Next generates at about 57–65 tok/s. Its server is busy 95–98% of the wall clock, and about 20% of that is spent reading prompts. Opus's pure generation speed is above its 74 tok/s wall rate, because that rate includes tool waits, but the transcripts don't let us separate the two.
2. **Tokens needed, about 2×.** Flash-Next produced twice the output tokens and made about 4× the calls for the same stories: longer thinking, more retries and more rework. It also ended up with the lower score.

So the reference is not mainly faster per token. It needs fewer tokens and fewer attempts to reach working code.

Every story ended with the agent's own build, typecheck and unit, component and integration tests passing. The agents' own e2e passed in Chromium and Firefox, except for load-related flakes they reported.

## Files

| Path | What |
|---|---|
| `workspace/` | the delivered code: no `.git`, `node_modules` or build output, and no `spec/`, which is `benchmarks/vidi/spec` |
| `workspace-git-log.txt` | the agent's commit history |
| `prompts/` | the exact per-story prompt each subagent received |
| `metrics.json` | minutes, subagent tokens, tool calls and commit per story |
| `accept.json` | held-out suite results, per test (fixed suite) |
| `AUDIT.md` | delivery audit: faults against the spec, one per row, and the held-out test faults |
| `agent-reports/` | each story agent's final report (its own claims) |
| `OMITTED.txt` | files left out for the repo's 512 KB limit (a synthetic test photo) |
