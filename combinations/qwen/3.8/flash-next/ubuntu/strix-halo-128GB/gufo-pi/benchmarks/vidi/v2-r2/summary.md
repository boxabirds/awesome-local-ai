# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 3/5 | 0 | 0 | 31/36 |
| 7 | 5/8 | 0 | 0 | 36/44 |
| 8 | 7/7 | 0 | 0 | 43/51 |
| 9 | 5/6 | 0 | 0 | 48/57 |

**New work** 44/53, **regressions** 0, **repairs** 0, **cumulative** 48/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 35.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 17.8 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 37.6 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 121.7 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 48.1 | None | None | None | — | — | red | 31/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 48.8 | None | None | None | — | — | red | 36/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 27.6 | None | None | None | — | — | red | 43/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE | 29.9 | None | None | None | — | — | red | 48/57 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 8 stories, 367 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/8, final acceptance 48/57, stalled 0, partial 0, 17056 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6357 / 0 | `BoardViewport.tsx` (267), `styles.css` (171), `useCamera.ts` (134), `NOTES.md` (104), `camera.ts` (101), `ZoomControls.tsx` (62), +14 more |
| 2 | 1 by the agent | 2397 / 109 | `StickyNote.tsx` (229), `App.tsx` (191), `styles.css` (191), `board-model.ts` (135), `NOTES.md` (115), `StickyText.ts` (103), +9 more |
| 3 | 1 by the agent | 3213 / 43 | `board-room.ts` (117), `connectBoard.ts` (83), `protocol.ts` (56), `NOTES.md` (40), `index.ts` (33), `ConnectionStatus.tsx` (32), +14 more |
| 4 | 1 by the agent | 2458 / 111 | `board-room.ts` (372), `board-store.ts` (323), `connectBoard.ts` (117), `room-state.ts` (92), `index.ts` (43), `App.tsx` (28), +7 more |
| 5 | 1 by the agent | 1777 / 41 | `styles.css` (144), `SharePanel.tsx` (137), `NOTES.md` (118), `BoardPage.tsx` (99), `board-store.ts` (86), `NotFoundPage.tsx` (46), +11 more |
| 7 | 1 by the agent | 3249 / 251 | `useTransformGesture.ts` (284), `board-model.ts` (234), `geometry.ts` (211), `App.tsx` (175), `StickyNote.tsx` (165), `SelectionOverlay.tsx` (162), +10 more |
| 8 | 1 by the agent | 1900 / 245 | `NOTES.md` (238), `undo.ts` (90), `UndoButtons.tsx` (63), `useBoardKeys.ts` (61), `StickyTextEditor.tsx` (61), `App.tsx` (46), +5 more |
| 9 | 1 by the agent | 2507 / 115 | `text.ts` (187), `TextEditor.tsx` (163), `textLayout.ts` (149), `TextObject.tsx` (138), `App.tsx` (129), `board-model.ts` (71), +17 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
