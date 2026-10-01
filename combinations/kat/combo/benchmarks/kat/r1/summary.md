# Vidi run — combo

Model `None`, scope `None`, effort `None`, client opencode , host None.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 2/3 | 0 | 0 | 2/3 |

**New work** 2/3, **regressions** 0, **repairs** 0, **cumulative** 2/3.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Greet the visitor | DONE | 0.0 | None | None | None | — | — | green | 2/3 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 1 stories, 0 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 2/3, stalled 0, partial 0, 0 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 40 / 0 | `package.json` (11), `build.js` (3), `.gitignore` (2), `index.js` (1), `package.json` (1) |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
