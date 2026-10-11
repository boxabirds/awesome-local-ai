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
| 5 | 3/5 | 0 | 0 | 33/36 |
| 7 | 8/8 | 0 | 0 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 5/6 | 0 | 0 | 53/57 |

**New work** 49/53, **regressions** 0, **repairs** 0, **cumulative** 53/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 95.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 98%, server peak 69 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 94.7 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 99%, server peak 71 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 240.1 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 5 | — | throttled 90%, server peak 73 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (green), on partial 3 | 240.1 | None | None | None | — | — | green | 30/31 |  | 0 / 1 | 5 | — | throttled 94%, server peak 75 GB |
| 5 | Share a board with others using a link | DONE, on partial 3, 4 | 189.2 | None | None | None | — | — | green | 33/36 |  | 0 / 1 | 5 | — | throttled 80%, server peak 75 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3, 4 | 185.7 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 5 | — | throttled 99%, server peak 76 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 3, 4 | 129.5 | None | None | None | — | — | red | 48/51 |  | 0 / 0 | 4 | — | throttled 98%, server peak 76 GB |
| 9 | Write free text anywhere on the board | PARTIAL (amber), on partial 3, 4 | 240.0 | None | None | None | — | — | green | 53/57 |  | 0 / 0 | 7 | — | throttled 95%, server peak 76 GB |

**Totals:** 8 stories, 1415 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/8, final acceptance 53/57, stalled 0, partial 3, 26711 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [4, 7, 8] (implementation: [4]), held-out 6/7 (floor 0.571).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **green**: gate green, tasks not verified none (implementation: none), held-out 4/4 (floor 1.0).
- Story 4, built on partial 3: held-out tests on the partial base 10/11; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 5, built on partial 3, 4: held-out tests on the partial base 13/16; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 7, built on partial 3, 4: held-out tests on the partial base 21/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 3, 4: held-out tests on the partial base 28/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 9 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [6, 8, 10] (implementation: [6, 8]), held-out 5/6 (floor 0.333).
- Story 9, built on partial 3, 4: held-out tests on the partial base 33/37; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6774 / 73 | `BoardViewport.tsx` (241), `useCamera.ts` (218), `camera.ts` (184), `styles.css` (177), `playwright.config.ts` (148), `ZoomControls.tsx` (104), +18 more |
| 2 | 9 by the agent | 3210 / 67 | `StickyNote.tsx` (299), `board-model.ts` (281), `styles.css` (191), `StickyText.ts` (161), `StickyTextEditor.tsx` (144), `App.tsx` (133), +8 more |
| 3 | 4 by the agent, + harness snapshot | 5699 / 218 | `board-room.ts` (225), `NOTES.md` (175), `connectBoard.ts` (174), `playwright.browsers.ts` (133), `playwright.config.ts` (115), `App.tsx` (78), +20 more |
| 4 | 8 by the agent | 5024 / 464 | `board-room.ts` (446), `board-store.ts` (428), `NOTES.md` (271), `App.tsx` (173), `room-state.ts` (125), `connectBoard.ts` (86), +14 more |
| 5 | 6 by the agent | 3350 / 408 | `App.tsx` (308), `BoardContents.tsx` (206), `styles.css` (181), `test-hooks.ts` (174), `SharePanel.tsx` (156), `BoardPage.tsx` (145), +18 more |
| 7 | 4 by the agent | 4826 / 500 | `useTransformGesture.ts` (405), `board-model.ts` (402), `geometry.ts` (300), `StickyNote.tsx` (271), `BoardContents.tsx` (270), `useSelection.ts` (218), +11 more |
| 8 | 1 by the agent | 1989 / 27 | `undo.ts` (143), `useUndo.ts` (91), `UndoButtons.tsx` (82), `NOTES.md` (66), `BoardContents.tsx` (55), `useBoardKeys.ts` (55), +6 more |
| 9 | 5 by the agent, + harness snapshot | 4592 / 440 | `text.ts` (296), `TextEditor.tsx` (275), `StickyTextEditor.tsx` (209), `textLayout.ts` (179), `TextObject.tsx` (147), `styles.css` (136), +20 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
