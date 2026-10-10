# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client opencode 1.18.30, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 5/7 | 0 | 0 | 23/27 |
| 4 | 4/4 | 0 | 0 | 27/31 |
| 5 | 4/5 | 0 | 0 | 31/36 |
| 7 | 8/8 | 0 | 0 | 39/44 |
| 8 | 7/7 | 0 | 0 | 46/51 |
| 9 | 6/6 | 0 | 0 | 52/57 |

**New work** 48/53, **regressions** 0, **repairs** 0, **cumulative** 52/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 52.5 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 45.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 139.0 | None | None | None | — | — | green | 23/27 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 107.5 | None | None | None | — | — | green | 27/31 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE | 46.9 | None | None | None | — | — | green | 31/36 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 70.1 | None | None | None | — | — | green | 39/44 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 57.1 | None | None | None | — | — | green | 46/51 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 9 | Write free text anywhere on the board | DONE | 50.8 | None | None | None | — | — | green | 52/57 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |

**Totals:** 8 stories, 569 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 8/8, final acceptance 52/57, stalled 0, partial 0, 14820 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6203 / 50 | `BoardViewport.tsx` (202), `styles.css` (152), `camera.ts` (139), `useCamera.ts` (136), `ZoomControls.tsx` (61), `NOTES.md` (55), +14 more |
| 2 | 1 by the agent | 2293 / 22 | `StickyNote.tsx` (229), `styles.css` (191), `board-model.ts` (162), `StickyTextEditor.tsx` (109), `App.tsx` (95), `StickyText.ts` (85), +10 more |
| 3 | 7 by the agent | 3802 / 65 | `board-room.ts` (147), `connectBoard.ts` (96), `protocol.ts` (73), `NOTES.md` (56), `playwright.nightly.config.ts` (42), `vitest.config.ts` (40), +19 more |
| 4 | 1 by the agent | 2484 / 77 | `board-room.ts` (297), `board-store.ts` (236), `room-state.ts` (83), `NOTES.md` (63), `seedBoard.ts` (63), `connectBoard.ts` (35), +16 more |
| 5 | 8 by the agent | 1660 / 199 | `App.tsx` (138), `BoardScreen.tsx` (124), `SharePanel.tsx` (120), `styles.css` (89), `index.ts` (73), `board-store.ts` (68), +14 more |
| 7 | 1 by the agent | 2799 / 298 | `useTransformGesture.ts` (265), `board-model.ts` (227), `StickyNote.tsx` (192), `BoardScreen.tsx` (151), `geometry.ts` (142), `useSelection.ts` (122), +10 more |
| 8 | 1 by the agent | 1282 / 20 | `undo.ts` (90), `NOTES.md` (58), `UndoButtons.tsx` (55), `BoardScreen.tsx` (51), `useUndo.ts` (44), `StickyTextEditor.tsx` (28), +8 more |
| 9 | 1 by the agent | 2100 / 205 | `TextEditor.tsx` (190), `StickyTextEditor.tsx` (167), `textLayout.ts` (123), `text.ts` (121), `TextObject.tsx` (100), `BoardScreen.tsx` (66), +18 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
