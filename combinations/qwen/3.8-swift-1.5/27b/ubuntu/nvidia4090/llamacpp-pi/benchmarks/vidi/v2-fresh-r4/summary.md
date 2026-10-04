# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 5/10 | 0 | 0 | 13/20 |
| 3 | 0/7 | 13 | 0 | 0/27 |
| 4 | 4/4 | 0 | 17 | 21/31 |
| 5 | 5/5 | 0 | 1 | 27/36 |
| 7 | 3/8 | 2 | 0 | 28/44 |
| 8 | 7/7 | 0 | 0 | 35/51 |

**New work** 29/47, **regressions** 15, **repairs** 18, **cumulative** 35/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 18.5 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 24.9 | None | None | None | — | — | green | 13/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 50.0 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 2 | — | throttled 0%, server peak 24 GB |
| 4 | Return to a board and find everything as it was left | DONE | 184.5 | None | None | None | — | — | red | 21/31 |  | 2 / 1 | 6 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 30.6 | None | None | None | — | — | red | 27/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 24.8 | None | None | None | — | — | red | 28/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 89.6 | None | None | None | — | — | red | 35/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |

**Totals:** 7 stories, 423 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/7, final acceptance 35/51, stalled 0, partial 0, 14392 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6709 / 38 | `BoardViewport.tsx` (214), `useCamera.ts` (193), `camera.ts` (184), `index.css` (146), `App.tsx` (57), `NOTES.md` (55), +15 more |
| 2 | 1 by the agent | 2271 / 24 | `StickyNote.tsx` (251), `index.css` (190), `board-model.ts` (189), `StickyText.ts` (108), `StickyTextEditor.tsx` (108), `App.tsx` (100), +8 more |
| 3 | 2 by the agent | 3392 / 83 | `board-room.ts` (141), `NOTES.md` (99), `connectBoard.ts` (88), `protocol.ts` (55), `ConnectionStatus.tsx` (54), `index.ts` (40), +13 more |
| 4 | 7 by the agent | 3170 / 252 | `board-store.ts` (501), `board-room.ts` (372), `room-state.ts` (89), `connectBoard.ts` (50), `index.ts` (34), `PROGRESS.md` (31), +9 more |
| 5 | 1 by the agent | 1966 / 236 | `App.tsx` (200), `index.css` (187), `BoardContent.tsx` (158), `SharePanel.tsx` (148), `index.ts` (89), `BoardPage.tsx` (82), +12 more |
| 7 | 1 by the agent | 3029 / 350 | `useTransformGesture.ts` (314), `board-model.ts` (268), `StickyNote.tsx` (238), `geometry.ts` (196), `BoardContent.tsx` (148), `useSelection.ts` (132), +11 more |
| 8 | 1 by the agent | 1689 / 36 | `undo.ts` (116), `useUndo.ts` (53), `StickyTextEditor.tsx` (50), `UndoButtons.tsx` (39), `useBoardKeys.ts` (34), `BoardContent.tsx` (30), +6 more |

### Earlier stories broken or fixed

- **Story 3 broke 13, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board; story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (141), `NOTES.md` (99), `connectBoard.ts` (88), `protocol.ts` (55), `ConnectionStatus.tsx` (54), `index.ts` (40), +13 more.
  - story 1: 8/10 → 0/10; broke 8.
  - story 2: 5/10 → 0/10; broke 5.
- **Story 4 broke 0, fixed 17** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4: Return to a board and find everything as it was left; story 4 task 6: E2E persistence across real process restarts (TC-19..TC-21); story 4 task 5: persistent room integration tests (TC-12..TC-18, TC-26); story 4 task 4: persistent BoardRoom (load on wake, store-before-broadcast, hibernation); story 4 tasks 2-3: BoardStore (schema, append, load+quarantine, chunked compaction) and integration tests; story 4 task 1: unit tests for chunking, compaction threshold, room state (TC-01, TC-02, TC-27)). Source files it changed most: `board-store.ts` (501), `board-room.ts` (372), `room-state.ts` (89), `connectBoard.ts` (50), `index.ts` (34), `PROGRESS.md` (31), +9 more.
  - story 1: 0/10 → 8/10; fixed 8
  - story 2: 0/10 → 5/10; fixed 5
  - story 3: 0/7 → 4/7; fixed 4
- **Story 5 broke 0, fixed 1** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `App.tsx` (200), `index.css` (187), `BoardContent.tsx` (158), `SharePanel.tsx` (148), `index.ts` (89), `BoardPage.tsx` (82), +12 more.
  - story 3: 4/7 → 5/7; fixed 1
- **Story 7 broke 2, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (314), `board-model.ts` (268), `StickyNote.tsx` (238), `geometry.ts` (196), `BoardContent.tsx` (148), `useSelection.ts` (132), +11 more.
  - story 2: 5/10 → 4/10; broke 1.
  - story 3: 5/7 → 4/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
