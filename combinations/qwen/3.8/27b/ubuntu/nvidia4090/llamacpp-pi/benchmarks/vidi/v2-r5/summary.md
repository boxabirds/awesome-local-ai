# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 4/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 0 | 0 | 42/44 |
| 8 | 7/7 | 0 | 0 | 49/51 |
| 9 | 6/6 | 1 | 0 | 54/57 |

**New work** 51/53, **regressions** 1, **repairs** 0, **cumulative** 54/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 32.7 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 50.2 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 117.4 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 5 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 127.7 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 6 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 63.8 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 102.9 | None | None | None | — | — | green | 42/44 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 55.6 | None | None | None | — | — | green | 49/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 60.2 | None | None | None | — | — | green | 54/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |

**Totals:** 8 stories, 611 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 8/8, final acceptance 54/57, stalled 0, partial 0, 17248 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6820 / 58 | `BoardViewport.tsx` (231), `useCamera.ts` (167), `camera.ts` (138), `app.css` (79), `NOTES.md` (62), `playwright.config.ts` (52), +15 more |
| 2 | 1 by the agent | 2478 / 21 | `StickyNote.tsx` (283), `board-model.ts` (197), `StickyTextEditor.tsx` (140), `App.tsx` (130), `app.css` (104), `StickyText.ts` (80), +10 more |
| 3 | 1 by the agent | 3904 / 42 | `connectBoard.ts` (162), `board-room.ts` (150), `protocol.ts` (73), `useBoardDoc.ts` (71), `NOTES.md` (69), `board-id.ts` (50), +12 more |
| 4 | 4 by the agent | 3027 / 112 | `board-room.ts` (559), `board-store.ts` (348), `NOTES.md` (148), `room-state.ts` (89), `playwright.persistence.config.ts` (65), `test-hooks.ts` (47), +12 more |
| 5 | 1 by the agent | 2262 / 323 | `App.tsx` (218), `app.css` (206), `Board.tsx` (179), `SharePanel.tsx` (156), `board-store.ts` (98), `index.ts` (84), +15 more |
| 7 | 6 by the agent | 3243 / 453 | `useTransformGesture.ts` (345), `Board.tsx` (312), `board-model.ts` (306), `StickyNote.tsx` (224), `geometry.ts` (188), `BoardViewport.tsx` (140), +12 more |
| 8 | 1 by the agent | 1648 / 25 | `undo.ts` (125), `UndoButtons.tsx` (69), `NOTES.md` (66), `useUndo.ts` (57), `useBoardKeys.ts` (43), `Board.tsx` (39), +7 more |
| 9 | 10 by the agent | 2466 / 179 | `text.ts` (222), `TextEditor.tsx` (202), `TextObject.tsx` (171), `textLayout.ts` (138), `Board.tsx` (132), `board-model.ts` (70), +18 more |

### Earlier stories broken or fixed

- **Story 9 broke 1, fixed 0** earlier held-out tests (story 9: Write free text anywhere on the board; story 9: text object component tests (TC-19 to TC-25); story 9: text object, editor, toolbar, e/w handles and group resize rule; story 9: tool mode component tests (TC-14 to TC-18); story 9: select/text tool modes with V/T/N/Escape shortcuts; story 9: box sync component tests (TC-12, TC-13); story 9: text layout and local-only box sync; story 9: text layout unit tests first (TC-07..TC-11, TC-32); story 9: text object model and shared text-edit helpers; story 9: text model unit tests first (TC-01..TC-06)). Source files it changed most: `text.ts` (222), `TextEditor.tsx` (202), `TextObject.tsx` (171), `textLayout.ts` (138), `Board.tsx` (132), `board-model.ts` (70), +18 more.
  - story 7: 8/8 → 7/8; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
