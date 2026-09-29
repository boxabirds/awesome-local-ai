# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |

**New work** 21/23, **regressions** 0, **repairs** 0, **cumulative** 25/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 20.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 45.5 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 116.7 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |

**Totals:** 3 stories, 182 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 25/27, stalled 0, partial 0, 6636 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7211 / 0 | `BoardViewport.tsx` (211), `camera.ts` (116), `useCamera.ts` (107), `ZoomControls.tsx` (101), `App.tsx` (82), `package.json` (33), +14 more |
| 2 | 3 by the agent | 2887 / 52 | `StickyNote.tsx` (392), `board-model.ts` (178), `StickyTextEditor.tsx` (133), `App.tsx` (107), `StickyText.ts` (101), `useBoardDoc.ts` (100), +8 more |
| 3 | 1 by the agent | 3274 / 23 | `board-room.ts` (151), `connectBoard.ts` (122), `protocol.ts` (114), `NOTES.md` (84), `ConnectionStatus.tsx` (66), `App.tsx` (59), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
