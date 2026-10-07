# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-iq3xxs-pi

Model `qwen3.8-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 1 | 36/36 |
| 7 | 5/8 | 2 | 0 | 39/44 |
| 8 | 7/7 | 0 | 0 | 46/51 |

**New work** 43/47, **regressions** 2, **repairs** 1, **cumulative** 46/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 79.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 78%, server peak 71 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 99.8 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 99%, server peak 76 GB |
| 3 | See other people's edits appear live on the same board | DONE | 169.3 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 3 | — | throttled 75%, server peak 77 GB |
| 4 | Return to a board and find everything as it was left | DONE | 172.3 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 3 | — | throttled 78%, server peak 77 GB |
| 5 | Share a board with others using a link | DONE | 90.3 | None | None | None | — | — | green | 36/36 |  | 0 / 0 | 2 | — | throttled 95%, server peak 78 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 44.1 | None | None | None | — | — | green | 39/44 |  | 0 / 1 | 1 | — | throttled 87%, server peak 78 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 88.4 | None | None | None | — | — | green | 46/51 |  | 0 / 0 | 2 | — | throttled 97%, server peak 78 GB |

**Totals:** 7 stories, 744 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/7, final acceptance 46/51, stalled 0, partial 0, 17401 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 7 by the agent | 6881 / 108 | `BoardViewport.tsx` (351), `useCamera.ts` (150), `camera.ts` (150), `index.css` (131), `NOTES.md` (116), `ZoomControls.tsx` (62), +14 more |
| 2 | 8 by the agent | 3431 / 138 | `StickyNote.tsx` (332), `StickyText.ts` (283), `board-model.ts` (258), `index.css` (186), `App.tsx` (126), `StickyTextEditor.tsx` (114), +13 more |
| 3 | 5 by the agent | 5136 / 149 | `connectBoard.ts` (174), `board-room.ts` (161), `NOTES.md` (88), `protocol.ts` (84), `App.tsx` (78), `useBoardDoc.ts` (69), +18 more |
| 4 | 8 by the agent | 3149 / 363 | `board-room.ts` (396), `board-store.ts` (360), `room-state.ts` (128), `NOTES.md` (77), `connectBoard.ts` (58), `index.ts` (46), +13 more |
| 5 | 4 by the agent | 2957 / 429 | `App.tsx` (250), `Board.tsx` (229), `SharePanel.tsx` (206), `index.css` (166), `NOTES.md` (98), `HomePage.tsx` (93), +16 more |
| 7 | 1 by the agent | 2692 / 280 | `useTransformGesture.ts` (325), `Board.tsx` (237), `board-model.ts` (178), `StickyNote.tsx` (171), `geometry.ts` (163), `SelectionOverlay.tsx` (135), +9 more |
| 8 | 5 by the agent | 1903 / 47 | `undo.ts` (164), `PROGRESS.md` (83), `useUndo.ts` (69), `Board.tsx` (62), `UndoButtons.tsx` (52), `NOTES.md` (47), +7 more |

### Earlier stories broken or fixed

- **Story 5 broke 0, fixed 1** earlier held-out tests (story 5: Share a board with others using a link; story 5: router + Home/Board/NotFound pages, api client, Share panel; component tests TC-16..TC-25 (board moved out of App into board/Board.tsx); story 5: board API (POST /api/boards, GET existence, 404 unknown rooms), test-hooks module, no-referrer meta; integration TC-05..TC-10,TC-12,TC-14,TC-15,TC-32; story 5: board id unit test TC-04 (link code strength) + named settings). Source files it changed most: `App.tsx` (250), `Board.tsx` (229), `SharePanel.tsx` (206), `index.css` (166), `NOTES.md` (98), `HomePage.tsx` (93), +16 more.
  - story 3: 6/7 → 7/7; fixed 1
- **Story 7 broke 2, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (325), `Board.tsx` (237), `board-model.ts` (178), `StickyNote.tsx` (171), `geometry.ts` (163), `SelectionOverlay.tsx` (135), +9 more.
  - story 2: 10/10 → 9/10; broke 1.
  - story 3: 7/7 → 6/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
