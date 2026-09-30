# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 4/7 | 0 | 0 | 21/27 |
| 4 | 4/4 | 0 | 0 | 25/31 |
| 5 | 5/5 | 0 | 0 | 30/36 |
| 7 | 8/8 | 0 | 1 | 39/44 |
| 8 | 7/7 | 0 | 0 | 46/51 |
| 9 | 5/6 | 1 | 0 | 50/57 |

**New work** 46/53, **regressions** 1, **repairs** 1, **cumulative** 50/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 44.6 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 75%, server peak 90 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 49.4 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 1 | — | throttled 98%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 161.9 | None | None | None | — | — | green | 21/27 |  | 0 / 0 | 5 | — | throttled 78%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | DONE | 117.7 | None | None | None | — | — | green | 25/31 |  | 0 / 0 | 4 | — | throttled 88%, server peak 94 GB |
| 5 | Share a board with others using a link | DONE | 63.4 | None | None | None | — | — | red | 30/36 |  | 0 / 0 | 3 | — | throttled 98%, server peak 94 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 133.0 | None | None | None | — | — | red | 39/44 |  | 0 / 0 | 6 | — | throttled 96%, server peak 94 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 63.5 | None | None | None | — | — | red | 46/51 |  | 0 / 0 | 2 | — | throttled 98%, server peak 94 GB |
| 9 | Write free text anywhere on the board | DONE | 97.9 | None | None | None | — | — | red | 50/57 |  | 0 / 0 | 4 | — | throttled 92%, server peak 95 GB |

**Totals:** 8 stories, 731 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/8, final acceptance 50/57, stalled 0, partial 0, 24617 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 7173 / 31 | `BoardViewport.tsx` (349), `useCamera.ts` (174), `camera.ts` (164), `ZoomControls.tsx` (88), `NOTES.md` (84), `playwright.config.ts` (60), +14 more |
| 2 | 7 by the agent | 2687 / 89 | `StickyNote.tsx` (296), `board-model.ts` (268), `StickyTextEditor.tsx` (200), `App.tsx` (196), `StickyText.ts` (166), `NoteToolbar.tsx` (81), +8 more |
| 3 | 5 by the agent | 5446 / 72 | `board-room.ts` (184), `connectBoard.ts` (177), `index.ts` (139), `protocol.ts` (114), `App.tsx` (65), `ConnectionStatus.tsx` (60), +11 more |
| 4 | 1 by the agent | 3758 / 219 | `board-room.ts` (506), `board-store.ts` (389), `test-hooks.ts` (203), `room-state.ts` (121), `connectBoard.ts` (57), `config.ts` (38), +7 more |
| 5 | 2 by the agent, + harness snapshot | 2220 / 358 | `App.tsx` (297), `Board.tsx` (242), `SharePanel.tsx` (224), `board-store.ts` (102), `HomePage.tsx` (96), `BoardPage.tsx` (77), +10 more |
| 7 | 3 by the agent | 4910 / 426 | `board-model.ts` (408), `useTransformGesture.ts` (355), `geometry.ts` (286), `Board.tsx` (278), `StickyNote.tsx` (231), `useSelection.ts` (161), +11 more |
| 8 | 2 by the agent | 1832 / 22 | `undo.ts` (151), `UndoButtons.tsx` (82), `StickyTextEditor.tsx` (74), `useUndo.ts` (51), `Board.tsx` (49), `NOTES.md` (45), +7 more |
| 9 | 2 by the agent | 4604 / 347 | `TextEditor.tsx` (368), `text.ts` (301), `StickyTextEditor.tsx` (289), `textLayout.ts` (252), `TextObject.tsx` (207), `Board.tsx` (117), +18 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Select, move, resize and delete several objects at once; story 7: selection, gesture, marquee, overlay, bar and keyboard, wired into the board; story 7: geometry and generic group operations (TC-01 to TC-10)). Source files it changed most: `board-model.ts` (408), `useTransformGesture.ts` (355), `geometry.ts` (286), `Board.tsx` (278), `StickyNote.tsx` (231), `useSelection.ts` (161), +11 more.
  - story 3: 4/7 → 5/7; fixed 1
- **Story 9 broke 1, fixed 0** earlier held-out tests (story 9: Write free text anywhere on the board; story 9: text object model, measurement, and their unit tests (TC-01 to TC-13)). Source files it changed most: `TextEditor.tsx` (368), `text.ts` (301), `StickyTextEditor.tsx` (289), `textLayout.ts` (252), `TextObject.tsx` (207), `Board.tsx` (117), +18 more.
  - story 3: 5/7 → 4/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
