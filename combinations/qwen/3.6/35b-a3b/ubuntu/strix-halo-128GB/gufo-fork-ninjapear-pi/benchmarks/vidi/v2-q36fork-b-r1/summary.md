# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |

**New work** 6/6, **regressions** 0, **repairs** 0, **cumulative** 6/6.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | PARTIAL (red) | 44.7 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 2 | — | throttled 0%, server peak 35 GB |

**Totals:** 1 stories, 45 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/1, final acceptance 6/6, stalled 0, partial 1, 1769 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 1 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 3, 4, 5]), held-out 6/6 (floor 0.833).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | harness snapshot (agent left work uncommitted) | 6291 / 7 | `BoardViewport.tsx` (238), `useCamera.ts` (183), `camera.ts` (169), `ZoomControls.tsx` (86), `package.json` (34), `vitest.config.ts` (33), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
