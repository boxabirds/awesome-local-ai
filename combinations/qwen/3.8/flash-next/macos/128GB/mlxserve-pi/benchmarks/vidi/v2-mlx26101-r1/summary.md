# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |

**New work** 29/32, **regressions** 0, **repairs** 0, **cumulative** 33/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 28.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 91%, server peak 89 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 37.4 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 1 | — | throttled 95%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 103.4 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 4 | — | throttled 86%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | DONE | 85.4 | None | None | None | — | — | green | 28/31 |  | 0 / 0 | 4 | — | throttled 97%, server peak 94 GB |
| 5 | Share a board with others using a link | DONE | 55.7 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 3 | — | throttled 97%, server peak 94 GB |

**Totals:** 5 stories, 310 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 33/36, stalled 0, partial 0, 13583 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6614 / 56 | `BoardViewport.tsx` (297), `camera.ts` (186), `useCamera.ts` (176), `ZoomControls.tsx` (108), `NOTES.md` (85), `App.tsx` (81), +15 more |
| 2 | 6 by the agent | 2719 / 88 | `board-model.ts` (290), `StickyNote.tsx` (260), `StickyTextEditor.tsx` (175), `StickyText.ts` (163), `App.tsx` (124), `NoteToolbar.tsx` (96), +9 more |
| 3 | 5 by the agent | 5639 / 85 | `board-room.ts` (206), `connectBoard.ts` (164), `NOTES.md` (153), `StickyText.ts` (119), `testHooks.ts` (89), `index.ts` (78), +15 more |
| 4 | 3 by the agent | 3059 / 124 | `board-room.ts` (395), `board-store.ts` (314), `room-state.ts` (129), `connectBoard.ts` (76), `test-hooks.ts` (46), `PROGRESS.md` (43), +11 more |
| 5 | 1 by the agent | 2975 / 338 | `App.tsx` (259), `SharePanel.tsx` (241), `Board.tsx` (232), `styles.css` (161), `BoardPage.tsx` (105), `board-store.ts` (97), +15 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
