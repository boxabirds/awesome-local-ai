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
| 7 | 8/8 | 0 | 0 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 6/6 | 1 | 0 | 53/57 |

**New work** 50/53, **regressions** 1, **repairs** 0, **cumulative** 53/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 36.9 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 48.3 | None | None | None | — | — | red | 18/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 170.4 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 181.1 | None | None | None | — | — | red | 28/31 |  | 1 / 0 | 8 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE | 38.5 | None | None | None | — | — | red | 33/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 182.9 | None | None | None | — | — | red | 41/44 |  | 0 / 1 | 9 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 58.1 | None | None | None | — | — | red | 48/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 95.0 | None | None | None | — | — | red | 53/57 |  | 1 / 1 | 4 | — | throttled 0%, server peak 18 GB |

**Totals:** 8 stories, 811 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/8, final acceptance 53/57, stalled 0, partial 0, 20239 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6838 / 37 | `useCamera.ts` (241), `BoardViewport.tsx` (227), `camera.ts` (160), `App.tsx` (137), `ZoomControls.tsx` (94), `NOTES.md` (63), +16 more |
| 2 | 4 by the agent | 2915 / 93 | `board-model.ts` (337), `StickyNote.tsx` (284), `StickyTextEditor.tsx` (194), `StickyText.ts` (152), `App.tsx` (125), `NoteToolbar.tsx` (102), +10 more |
| 3 | 1 by the agent | 4565 / 48 | `connectBoard.ts` (177), `board-room.ts` (168), `protocol.ts` (72), `App.tsx` (62), `StickyTextEditor.tsx` (59), `testHooks.ts` (58), +14 more |
| 4 | 10 by the agent | 3569 / 160 | `board-room.ts` (375), `board-store.ts` (294), `NOTES.md` (221), `test-hooks.ts` (101), `room-state.ts` (89), `storage-chunks.ts` (71), +12 more |
| 5 | 1 by the agent | 2087 / 362 | `App.tsx` (314), `Board.tsx` (270), `SharePanel.tsx` (242), `BoardPage.tsx` (112), `HomePage.tsx` (104), `index.ts` (81), +11 more |
| 7 | 1 by the agent | 4038 / 613 | `board-model.ts` (419), `useTransformGesture.ts` (396), `Board.tsx` (264), `StickyNote.tsx` (249), `geometry.ts` (236), `useSelection.ts` (160), +13 more |
| 8 | 1 by the agent | 1744 / 27 | `undo.ts` (99), `NOTES.md` (91), `UndoButtons.tsx` (78), `useUndo.ts` (51), `Board.tsx` (42), `useBoardKeys.ts` (39), +8 more |
| 9 | 1 by the agent | 3153 / 395 | `TextEditor.tsx` (357), `StickyTextEditor.tsx` (294), `text.ts` (208), `textLayout.ts` (185), `TextObject.tsx` (149), `useTransformGesture.ts` (132), +17 more |

### Earlier stories broken or fixed

- **Story 9 broke 1, fixed 0** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `TextEditor.tsx` (357), `StickyTextEditor.tsx` (294), `text.ts` (208), `textLayout.ts` (185), `TextObject.tsx` (149), `useTransformGesture.ts` (132), +17 more.
  - story 3: 6/7 → 5/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
