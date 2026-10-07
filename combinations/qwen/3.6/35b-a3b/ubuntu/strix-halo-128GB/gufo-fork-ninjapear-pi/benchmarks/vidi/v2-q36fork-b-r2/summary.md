# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 2/10 | 0 | 0 | 8/20 |

**New work** 8/16, **regressions** 0, **repairs** 0, **cumulative** 8/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 41.7 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (amber) | 33.2 | None | None | None | — | — | green | 8/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |

**Totals:** 2 stories, 75 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 8/20, stalled 0, partial 1, 3886 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **amber**: gate green, tasks not verified [4, 5, 6, 7, 8] (implementation: [4, 5, 6]), held-out 2/10 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6594 / 64 | `BoardViewport.tsx` (354), `camera.ts` (174), `useCamera.ts` (167), `ZoomControls.tsx` (106), `App.tsx` (78), `playwright.config.ts` (42), +15 more |
| 2 | 1 by the agent, + harness snapshot | 2172 / 52 | `board-model.ts` (362), `StickyNote.tsx` (301), `App.tsx` (146), `BoardViewport.tsx` (141), `StickyTextEditor.tsx` (93), `NoteToolbar.tsx` (85), +6 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
