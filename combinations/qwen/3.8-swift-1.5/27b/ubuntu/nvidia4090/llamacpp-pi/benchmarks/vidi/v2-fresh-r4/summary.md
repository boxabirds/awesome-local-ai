# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 5/10 | 0 | 0 | 13/20 |
| 3 | 0/7 | 13 | 0 | 0/27 |

**New work** 10/23, **regressions** 13, **repairs** 0, **cumulative** 0/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 18.5 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 24.9 | None | None | None | — | — | green | 13/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 50.0 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 2 | — | throttled 0%, server peak 24 GB |

**Totals:** 3 stories, 93 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 0/27, stalled 0, partial 0, 5582 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6709 / 38 | `BoardViewport.tsx` (214), `useCamera.ts` (193), `camera.ts` (184), `index.css` (146), `App.tsx` (57), `NOTES.md` (55), +15 more |
| 2 | 1 by the agent | 2271 / 24 | `StickyNote.tsx` (251), `index.css` (190), `board-model.ts` (189), `StickyText.ts` (108), `StickyTextEditor.tsx` (108), `App.tsx` (100), +8 more |
| 3 | 2 by the agent | 3392 / 83 | `board-room.ts` (141), `NOTES.md` (99), `connectBoard.ts` (88), `protocol.ts` (55), `ConnectionStatus.tsx` (54), `index.ts` (40), +13 more |

### Earlier stories broken or fixed

- **Story 3 broke 13, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board; story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (141), `NOTES.md` (99), `connectBoard.ts` (88), `protocol.ts` (55), `ConnectionStatus.tsx` (54), `index.ts` (40), +13 more.
  - story 1: 8/10 → 0/10; broke 8.
  - story 2: 5/10 → 0/10; broke 5.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
