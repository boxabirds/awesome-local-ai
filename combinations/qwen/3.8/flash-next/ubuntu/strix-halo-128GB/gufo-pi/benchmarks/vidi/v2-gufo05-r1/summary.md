# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 4/7 | 0 | 0 | 21/27 |

**New work** 17/23, **regressions** 0, **repairs** 0, **cumulative** 21/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 52.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 82.1 | None | None | None | — | — | green | 17/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.1 | None | None | None | — | — | green | 21/27 |  | 2 / 1 | 4 | — | throttled 0%, server peak 0 GB |

**Totals:** 3 stories, 302 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 21/27, stalled 0, partial 0, 9679 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6372 / 53 | `BoardViewport.tsx` (272), `useCamera.ts` (270), `camera.ts` (188), `styles.css` (181), `NOTES.md` (114), `playwright.config.ts` (106), +17 more |
| 2 | 4 by the agent | 3690 / 118 | `StickyNote.tsx` (411), `board-model.ts` (280), `styles.css` (183), `StickyTextEditor.tsx` (154), `App.tsx` (140), `NOTES.md` (130), +9 more |
| 3 | 4 by the agent | 21140 / 137 | `worker-configuration.d.ts` (16189), `connectBoard.ts` (195), `board-room.ts` (173), `protocol.ts` (133), `NOTES.md` (132), `StickyTextEditor.tsx` (82), +19 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
