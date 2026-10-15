# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 8/8 | 2 | 0 | 39/44 |

**New work** 37/40, **regressions** 2, **repairs** 0, **cumulative** 39/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 49.1 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 2 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 47.8 | None | None | None | — | — | red | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 139.6 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 153.8 | None | None | None | — | — | red | 28/31 |  | 1 / 0 | 6 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE | 103.7 | None | None | None | — | — | red | 33/36 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 118.5 | None | None | None | — | — | red | 39/44 |  | 0 / 0 | 6 | — | throttled 0%, server peak 18 GB |

**Totals:** 6 stories, 612 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/6, final acceptance 39/44, stalled 0, partial 0, 15812 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6005 / 43 | `useCamera.ts` (235), `BoardViewport.tsx` (190), `camera.ts` (187), `styles.css` (139), `NOTES.md` (86), `App.tsx` (79), +14 more |
| 2 | 1 by the agent | 2757 / 25 | `StickyNote.tsx` (297), `board-model.ts` (245), `styles.css` (178), `StickyTextEditor.tsx` (157), `StickyText.ts` (122), `useSelection.ts` (107), +10 more |
| 3 | 6 by the agent | 4419 / 1428 | `connectBoard.ts` (200), `board-room.ts` (186), `protocol.ts` (140), `useBoardDoc.ts` (116), `App.tsx` (83), `PROGRESS.md` (82), +12 more |
| 4 | 1 by the agent | 3403 / 120 | `board-room.ts` (343), `board-store.ts` (342), `test-hooks.ts` (199), `connectBoard.ts` (131), `room-state.ts` (108), `NOTES.md` (87), +14 more |
| 5 | 1 by the agent | 2393 / 270 | `BoardPage.tsx` (266), `App.tsx` (230), `styles.css` (161), `SharePanel.tsx` (149), `NOTES.md` (128), `board-store.ts` (109), +14 more |
| 7 | 1 by the agent | 4112 / 462 | `useTransformGesture.ts` (394), `StickyNote.tsx` (332), `board-model.ts` (308), `geometry.ts` (242), `useSelection.ts` (233), `BoardPage.tsx` (170), +13 more |

### Earlier stories broken or fixed

- **Story 7 broke 2, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (394), `StickyNote.tsx` (332), `board-model.ts` (308), `geometry.ts` (242), `useSelection.ts` (233), `BoardPage.tsx` (170), +13 more.
  - story 2: 8/10 → 7/10; broke 1.
  - story 3: 6/7 → 5/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
