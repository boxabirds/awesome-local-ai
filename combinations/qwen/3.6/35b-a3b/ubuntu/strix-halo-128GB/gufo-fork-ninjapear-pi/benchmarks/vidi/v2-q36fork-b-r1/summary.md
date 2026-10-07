# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 2/10 | 0 | 0 | 11/20 |
| 3 | 0/7 | 11 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 1/5 | 0 | 0 | 1/36 |
| 7 | 0/8 | 0 | 0 | 1/44 |
| 8 | 0/7 | 0 | 0 | 1/51 |
| 9 | 0/6 | 0 | 0 | 1/57 |

**New work** 9/53, **regressions** 11, **repairs** 0, **cumulative** 1/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | PARTIAL (red) | 44.7 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 2 | — | throttled 0%, server peak 35 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (red), on partial 1 | 14.1 | None | None | None | — | — | red | 11/20 |  | 0 / 1 | 0 | — | throttled 0%, server peak 35 GB |
| 3 | See other people's edits appear live on the same board | DONE, on partial 1, 2 | 33.2 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 35 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 1, 2 | 135.3 | None | None | None | — | — | red | 0/31 |  | 3 / 0 | 1 | — | throttled 0%, server peak 36 GB |
| 5 | Share a board with others using a link | PARTIAL (red), on partial 1, 2 | 58.8 | None | None | None | — | — | red | 1/36 |  | 0 / 1 | 1 | — | throttled 0%, server peak 36 GB |
| 7 | Select, move, resize and delete several objects at once | PARTIAL (red), on partial 1, 2, 5 | 75.4 | None | None | None | — | — | red | 1/44 |  | 0 / 1 | 1 | — | throttled 0%, server peak 36 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 1, 2, 5, 7 | 41.3 | None | None | None | — | — | red | 1/51 |  | 0 / 1 | 1 | — | throttled 0%, server peak 36 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 1, 2, 5, 7 | 78.4 | None | None | None | — | — | red | 1/57 |  | 0 / 0 | 1 | — | throttled 0%, server peak 37 GB |

**Totals:** 8 stories, 481 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/8, final acceptance 1/57, stalled 0, partial 4, 12894 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 1 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 3, 4, 5]), held-out 6/6 (floor 0.833).
- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8] (implementation: [2, 4, 5, 6]), held-out 2/10 (floor 0.0).
- Story 2, built on partial 1: held-out tests on the partial base 11/20; partial story's tests fixed 3, regressed 0; 0 stub-like lines added to src/.
- Story 3, built on partial 1, 2: held-out tests on the partial base 0/27; partial story's tests fixed 0, regressed 8; 0 stub-like lines added to src/.
- Story 4, built on partial 1, 2: held-out tests on the partial base 0/31; partial story's tests fixed 0, regressed 8; 0 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 1/5 (floor 0.0).
- Story 5, built on partial 1, 2: held-out tests on the partial base 1/36; partial story's tests fixed 0, regressed 8; 0 stub-like lines added to src/.
- **Story 7 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [2, 8, 10, 11, 12, 13]), held-out 0/8 (floor 0.0).
- Story 7, built on partial 1, 2, 5: held-out tests on the partial base 1/44; partial story's tests fixed 0, regressed 8; 3 stub-like lines added to src/.
- Story 8, built on partial 1, 2, 5, 7: held-out tests on the partial base 1/51; partial story's tests fixed 0, regressed 8; 0 stub-like lines added to src/.
- Story 9, built on partial 1, 2, 5, 7: held-out tests on the partial base 1/57; partial story's tests fixed 0, regressed 8; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | harness snapshot (agent left work uncommitted) | 6291 / 7 | `BoardViewport.tsx` (238), `useCamera.ts` (183), `camera.ts` (169), `ZoomControls.tsx` (86), `package.json` (34), `vitest.config.ts` (33), +16 more |
| 2 | harness snapshot (agent left work uncommitted) | 1514 / 32 | `StickyNote.tsx` (277), `board-model.ts` (180), `StickyTextEditor.tsx` (145), `App.tsx` (111), `StickyText.ts` (91), `NoteToolbar.tsx` (80), +7 more |
| 3 | 1 by the agent | 2915 / 126 | `board-room.ts` (180), `ConnectionStatus.tsx` (142), `connectBoard.ts` (96), `NOTES.md` (68), `protocol.ts` (59), `index.ts` (57), +10 more |
| 4 | 1 by the agent | 1453 / 247 | `board-room.ts` (430), `board-store-do.ts` (242), `NOTES.md` (111), `room-state.ts` (80), `ConnectionStatus.tsx` (56), `board-store.ts` (52), +11 more |
| 5 | harness snapshot (agent left work uncommitted) | 1682 / 38 | `SharePanel.tsx` (202), `BoardRoot.tsx` (167), `BoardPage.tsx` (114), `index.ts` (97), `HomePage.tsx` (83), `NotFoundPage.tsx` (73), +11 more |
| 7 | harness snapshot (agent left work uncommitted) | 2545 / 274 | `useTransformGesture.ts` (304), `board-model.ts` (215), `SelectionOverlay.tsx` (179), `geometry.ts` (176), `App.tsx` (157), `useSelection.ts` (144), +10 more |
| 8 | 1 by the agent | 1496 / 55 | `undo.ts` (111), `App.tsx` (75), `UndoButtons.tsx` (70), `BoardRoot.tsx` (56), `useUndo.ts` (54), `useBoardKeys.ts` (49), +9 more |
| 9 | 1 by the agent | 2258 / 348 | `App.tsx` (229), `text.ts` (187), `StickyTextEditor.tsx` (169), `TextEditor.tsx` (168), `TextObject.tsx` (150), `textLayout.ts` (134), +15 more |

### Earlier stories broken or fixed

- **Story 3 broke 11, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (180), `ConnectionStatus.tsx` (142), `connectBoard.ts` (96), `NOTES.md` (68), `protocol.ts` (59), `index.ts` (57), +10 more.
  - story 1: 9/10 → 0/10; broke 9.
  - story 2: 2/10 → 0/10; broke 2.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
