# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 2/5 | 0 | 0 | 31/36 |
| 7 | 8/8 | 0 | 0 | 39/44 |
| 8 | 7/7 | 0 | 0 | 46/51 |

**New work** 42/47, **regressions** 0, **repairs** 0, **cumulative** 46/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 45.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 80.9 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 127.0 | None | None | None | — | — | green | 25/27 |  | 1 / 1 | 4 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 167.3 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 73.1 | None | None | None | — | — | red | 31/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 211.8 | None | None | None | — | — | green | 39/44 |  | 0 / 0 | 8 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 181.4 | None | None | None | — | — | green | 46/51 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |

**Totals:** 7 stories, 887 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/7, final acceptance 46/51, stalled 0, partial 0, 23690 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6664 / 7 | `BoardViewport.tsx` (291), `useCamera.ts` (181), `camera.ts` (149), `styles.css` (128), `NOTES.md` (104), `playwright.config.ts` (97), +15 more |
| 2 | 5 by the agent | 4100 / 72 | `StickyNote.tsx` (319), `board-model.ts` (265), `StickyText.ts` (202), `styles.css` (193), `StickyTextEditor.tsx` (149), `App.tsx` (126), +10 more |
| 3 | 1 by the agent | 4740 / 165 | `board-room.ts` (212), `connectBoard.ts` (170), `protocol.ts` (108), `useBoardDoc.ts` (66), `index.ts` (55), `board-id.ts` (52), +18 more |
| 4 | 3 by the agent | 4211 / 198 | `board-room.ts` (546), `board-store.ts` (506), `room-state.ts` (156), `NOTES.md` (100), `test-hooks.ts` (91), `App.tsx` (80), +12 more |
| 5 | 1 by the agent | 2690 / 282 | `App.tsx` (227), `BoardView.tsx` (218), `SharePanel.tsx` (168), `board-store.ts` (154), `styles.css` (119), `BoardPage.tsx` (107), +16 more |
| 7 | 1 by the agent | 5920 / 381 | `board-model.ts` (387), `useTransformGesture.ts` (385), `geometry.ts` (346), `StickyNote.tsx` (249), `NOTES.md` (229), `BoardView.tsx` (208), +12 more |
| 8 | 6 by the agent | 2898 / 113 | `undo.ts` (284), `NOTES.md` (118), `useUndo.ts` (92), `UndoButtons.tsx` (89), `BoardView.tsx` (66), `useBoardKeys.ts` (49), +7 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
