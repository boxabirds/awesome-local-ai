# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 8/10 | 0 | 1 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 8/8 | 0 | 0 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 5/6 | 0 | 0 | 53/57 |
| 10 | 8/8 | 0 | 0 | 61/65 |

**New work** 56/61, **regressions** 0, **repairs** 1, **cumulative** 61/65.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 40.8 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 54.6 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 175.8 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 174.8 | None | None | None | — | — | green | 28/31 |  | 0 / 1 | 5 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 64.9 | None | None | None | — | — | green | 33/36 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 115.7 | None | None | None | — | — | green | 41/44 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 75.0 | None | None | None | — | — | green | 48/51 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE | 76.3 | None | None | None | — | — | green | 53/57 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 113.5 | None | None | None | — | — | green | 61/65 |  | 0 / 1 | 4 | — | throttled 0%, server peak 0 GB |

**Totals:** 9 stories, 891 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 9/9, final acceptance 61/65, stalled 0, partial 0, 28530 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6059 / 62 | `useCamera.ts` (255), `BoardViewport.tsx` (236), `camera.ts` (190), `styles.css` (174), `NOTES.md` (105), `playwright.config.ts` (94), +15 more |
| 2 | 1 by the agent | 2651 / 27 | `StickyNote.tsx` (214), `board-model.ts` (191), `styles.css` (184), `App.tsx` (160), `StickyTextEditor.tsx` (152), `StickyText.ts` (134), +10 more |
| 3 | 7 by the agent | 5002 / 305 | `NOTES.md` (367), `board-room.ts` (217), `connectBoard.ts` (149), `protocol.ts` (75), `vitest.config.ts` (53), `index.ts` (51), +16 more |
| 4 | 4 by the agent | 4350 / 141 | `board-room.ts` (588), `board-store.ts` (522), `test-hooks.ts` (257), `NOTES.md` (121), `room-state.ts` (119), `connectBoard.ts` (55), +16 more |
| 5 | 1 by the agent | 2848 / 278 | `App.tsx` (271), `styles.css` (263), `BoardSurface.tsx` (229), `SharePanel.tsx` (213), `NOTES.md` (164), `board-store.ts` (133), +17 more |
| 7 | 3 by the agent | 4059 / 455 | `board-model.ts` (322), `useTransformGesture.ts` (300), `BoardSurface.tsx` (256), `geometry.ts` (233), `useSelection.ts` (228), `StickyNote.tsx` (223), +12 more |
| 8 | 1 by the agent | 1348 / 17 | `undo.ts` (121), `NOTES.md` (84), `UndoButtons.tsx` (65), `useUndo.ts` (65), `BoardSurface.tsx` (40), `StickyTextEditor.tsx` (30), +8 more |
| 9 | 4 by the agent | 3736 / 390 | `TextEditor.tsx` (310), `text.ts` (298), `StickyTextEditor.tsx` (246), `textLayout.ts` (223), `TextObject.tsx` (140), `NOTES.md` (126), +16 more |
| 10 | 1 by the agent | 5721 / 36 | `connector.ts` (368), `ConnectorObject.tsx` (337), `shape.ts` (250), `ConnectorTool.tsx` (241), `styles.css` (228), `ShapeObject.tsx` (189), +16 more |

### Earlier stories broken or fixed

- **Story 2 broke 0, fixed 1** earlier held-out tests (story 2: Capture ideas on sticky notes and rearrange them). Source files it changed most: `StickyNote.tsx` (214), `board-model.ts` (191), `styles.css` (184), `App.tsx` (160), `StickyTextEditor.tsx` (152), `StickyText.ts` (134), +10 more.
  - story 1: 5/6 → 10/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
