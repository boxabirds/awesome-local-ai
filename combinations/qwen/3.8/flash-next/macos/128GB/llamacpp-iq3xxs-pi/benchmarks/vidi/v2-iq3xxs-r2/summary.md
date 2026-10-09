# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-iq3xxs-pi

Model `qwen3.8-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 1 | 0 | 29/31 |
| 5 | 5/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 0 | 1 | 43/44 |
| 8 | 7/7 | 0 | 0 | 50/51 |
| 9 | 5/6 | 0 | 1 | 56/57 |
| 10 | 8/8 | 1 | 0 | 63/65 |
| 11 | 5/5 | 0 | 0 | 68/70 |

**New work** 64/66, **regressions** 2, **repairs** 2, **cumulative** 68/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 132.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 61%, server peak 73 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 96.9 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 99%, server peak 73 GB |
| 3 | See other people's edits appear live on the same board | DONE | 204.2 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 4 | — | throttled 78%, server peak 79 GB |
| 4 | Return to a board and find everything as it was left | DONE | 208.7 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 4 | — | throttled 83%, server peak 79 GB |
| 5 | Share a board with others using a link | DONE | 99.0 | None | None | None | — | — | green | 34/36 |  | 0 / 1 | 2 | — | throttled 83%, server peak 79 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 211.4 | None | None | None | — | — | green | 43/44 |  | 0 / 0 | 5 | — | throttled 97%, server peak 79 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 170.4 | None | None | None | — | — | green | 50/51 |  | 0 / 0 | 4 | — | throttled 90%, server peak 79 GB |
| 9 | Write free text anywhere on the board | DONE | 148.5 | None | None | None | — | — | green | 56/57 |  | 0 / 1 | 4 | — | throttled 92%, server peak 79 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 140.5 | None | None | None | — | — | green | 63/65 |  | 0 / 0 | 4 | — | throttled 92%, server peak 79 GB |
| 11 | Sketch freehand with a pen | DONE | 97.3 | None | None | None | — | — | green | 68/70 |  | 0 / 0 | 3 | — | throttled 93%, server peak 79 GB |

**Totals:** 10 stories, 1509 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 10/10, final acceptance 68/70, stalled 0, partial 0, 35646 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6672 / 88 | `BoardViewport.tsx` (231), `useCamera.ts` (228), `camera.ts` (192), `styles.css` (139), `NOTES.md` (104), `playwright.config.ts` (99), +15 more |
| 2 | 4 by the agent | 3998 / 128 | `StickyNote.tsx` (423), `board-model.ts` (322), `styles.css` (171), `StickyText.ts` (169), `StickyTextEditor.tsx` (132), `App.tsx` (123), +10 more |
| 3 | 5 by the agent | 5543 / 218 | `board-room.ts` (261), `PROGRESS.md` (146), `protocol.ts` (95), `StickyText.ts` (91), `connectBoard.ts` (90), `index.ts` (66), +16 more |
| 4 | 6 by the agent | 3347 / 193 | `board-room.ts` (459), `board-store.ts` (412), `BoardSocket.ts` (297), `connectBoard.ts` (139), `room-state.ts` (102), `NOTES.md` (78), +14 more |
| 5 | 7 by the agent | 3031 / 395 | `SharePanel.tsx` (352), `App.tsx` (204), `Board.tsx` (173), `styles.css` (135), `state.ts` (122), `router.ts` (117), +15 more |
| 7 | 9 by the agent | 5402 / 507 | `useTransformGesture.ts` (399), `board-model.ts` (360), `useSelection.ts` (345), `geometry.ts` (314), `StickyNote.tsx` (259), `Board.tsx` (206), +10 more |
| 8 | 5 by the agent | 2375 / 27 | `undo.ts` (144), `NOTES.md` (133), `UndoButtons.tsx` (93), `useUndo.ts` (58), `Board.tsx` (45), `styles.css` (37), +7 more |
| 9 | 9 by the agent | 4429 / 482 | `text.ts` (371), `textLayout.ts` (231), `TextEditor.tsx` (230), `TextObject.tsx` (215), `StickyTextEditor.tsx` (209), `text-edit.ts` (207), +18 more |
| 10 | 6 by the agent | 5913 / 121 | `connector.ts` (443), `ConnectorObject.tsx` (377), `shape.ts` (311), `ShapeObject.tsx` (310), `ConnectorTool.tsx` (233), `ShapeTool.tsx` (186), +17 more |
| 11 | 1 by the agent | 3509 / 19 | `PenTool.tsx` (308), `stroke.ts` (263), `StrokeObject.tsx` (138), `simplify.ts` (131), `PenToolbar.tsx` (123), `styles.css` (117), +11 more |

### Earlier stories broken or fixed

- **Story 4 broke 1, fixed 0** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4 task 7+8: client load-failure state with the red badge; component tests for badge, edit lock and close-code mapping (TC-22, TC-23, TC-28); story 4 task 4+5: persistent hibernating BoardRoom; integration tests for durability, failures and hibernation (TC-12 to TC-18, TC-26); story 4 task 3: BoardStore integration tests on real DO SQLite (TC-03..TC-11, TC-25); probe-doc quarantine and compaction gap guard; story 4 task 2: BoardStore (SQLite schema, append, load with quarantine, chunked compaction); TC-01/TC-02 green; story 4 task 1: unit tests for chunking, compaction threshold and room state machine (TC-01, TC-02, TC-27) with stubs). Source files it changed most: `board-room.ts` (459), `board-store.ts` (412), `BoardSocket.ts` (297), `connectBoard.ts` (139), `room-state.ts` (102), `NOTES.md` (78), +14 more.
  - story 3: 6/7 → 5/7; broke 1.
- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Select, move, resize and delete several objects at once; fix(sel): a browser's focus and a deferred frame must not undo a selection; test(sel): end-to-end multi-select (TC-32 to TC-36); test(sel): marquee, transform gesture and keyboard component tests (TC-20 to TC-31); feat(sel): multi-select board UI — registry-rendered objects, outlines, selection bar, marquee, transform gesture, keyboard commands; test(sel): selection reducer unit tests (TC-13 to TC-15); test(sel): registry unit tests and the test-only testbox type (TC-11, TC-12); feat(sel): shared rectangle maths and generic group operations over any object type; test(sel): unit tests for the shared rectangle maths and the group operations (TC-01 to TC-10)). Source files it changed most: `useTransformGesture.ts` (399), `board-model.ts` (360), `useSelection.ts` (345), `geometry.ts` (314), `StickyNote.tsx` (259), `Board.tsx` (206), +10 more.
  - story 3: 5/7 → 6/7; fixed 1
- **Story 9 broke 0, fixed 1** earlier held-out tests (story 9: Write free text anywhere on the board; test(text): component tests for the two tools and for text objects (TC-14 to TC-25); feat(text): TextObject, a generalised TextEditor, the size toolbar and horizontal-only handles; feat(tool): Select and Text tools with V, T, N and Escape; test(text): box sync writes only after local changes (TC-12, TC-13); feat(text): text layout and local-only box sync; test(text): layout tests with a fake measurer (TC-07 to TC-11, TC-32); feat(text): the text object model and the shared text-edit helpers; test(text): unit tests for the text object model (TC-01 to TC-06)). Source files it changed most: `text.ts` (371), `textLayout.ts` (231), `TextEditor.tsx` (230), `TextObject.tsx` (215), `StickyTextEditor.tsx` (209), `text-edit.ts` (207), +18 more.
  - story 3: 6/7 → 7/7; fixed 1
- **Story 10 broke 1, fixed 0** earlier held-out tests (story 10 task 15: e2e for shapes and arrows (TC-23..TC-27), arrow takes pointer only on its line; story 10 task 12-14: shape and connector UI, registry, component tests (TC-15..TC-22, TC-28); story 10 task 11: active tool hook, s/l shortcuts, shape kind menu; story 10 task 10: connector model, geometry, detach-on-delete; story 10 task 9: connector model and geometry unit tests, with stubs; story 10 task 7-8: shape model, settings and unit tests). Source files it changed most: `connector.ts` (443), `ConnectorObject.tsx` (377), `shape.ts` (311), `ShapeObject.tsx` (310), `ConnectorTool.tsx` (233), `ShapeTool.tsx` (186), +17 more.
  - story 3: 7/7 → 6/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
