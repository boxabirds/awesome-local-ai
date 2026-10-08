# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |

**New work** 20/23, **regressions** 0, **repairs** 0, **cumulative** 24/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 36.9 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 48.3 | None | None | None | — | — | red | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 170.4 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 17 GB |

**Totals:** 3 stories, 256 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/3, final acceptance 24/27, stalled 0, partial 0, 7656 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6838 / 37 | `useCamera.ts` (241), `BoardViewport.tsx` (227), `camera.ts` (160), `App.tsx` (137), `ZoomControls.tsx` (94), `NOTES.md` (63), +16 more |
| 2 | 4 by the agent | 2915 / 93 | `board-model.ts` (337), `StickyNote.tsx` (284), `StickyTextEditor.tsx` (194), `StickyText.ts` (152), `App.tsx` (125), `NoteToolbar.tsx` (102), +10 more |
| 3 | 1 by the agent | 4565 / 48 | `connectBoard.ts` (177), `board-room.ts` (168), `protocol.ts` (72), `App.tsx` (62), `StickyTextEditor.tsx` (59), `testHooks.ts` (58), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
