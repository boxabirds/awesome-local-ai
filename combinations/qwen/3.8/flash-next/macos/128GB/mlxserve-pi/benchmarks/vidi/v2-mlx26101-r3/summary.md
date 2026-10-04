# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |

**New work** 22/23, **regressions** 0, **repairs** 0, **cumulative** 26/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 43.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 93%, server peak 93 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 82.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 4 | — | throttled 97%, server peak 93 GB |
| 3 | See other people's edits appear live on the same board | DONE | 194.1 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 6 | — | throttled 54%, server peak 93 GB |

**Totals:** 3 stories, 320 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 26/27, stalled 0, partial 0, 11715 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 8166 / 114 | `BoardViewport.tsx` (302), `useCamera.ts` (249), `camera.ts` (188), `styles.css` (182), `NOTES.md` (129), `ZoomControls.tsx` (91), +17 more |
| 2 | 3 by the agent | 5013 / 91 | `StickyNote.tsx` (434), `board-model.ts` (370), `StickyText.ts` (211), `StickyTextEditor.tsx` (211), `styles.css` (185), `App.tsx` (135), +9 more |
| 3 | 5 by the agent | 5866 / 118 | `NOTES.md` (218), `board-room.ts` (209), `StickyText.ts` (127), `protocol.ts` (112), `StickyTextEditor.tsx` (110), `connectBoard.ts` (101), +19 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
