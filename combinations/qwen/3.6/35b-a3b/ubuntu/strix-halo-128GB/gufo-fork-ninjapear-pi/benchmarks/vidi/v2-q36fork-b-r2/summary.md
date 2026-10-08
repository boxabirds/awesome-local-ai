# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 2/10 | 0 | 0 | 8/20 |
| 3 | 0/7 | 8 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 0/5 | 0 | 0 | 0/36 |
| 7 | 0/8 | 0 | 0 | 0/44 |
| 8 | 0/7 | 0 | 0 | 0/51 |
| 9 | 0/6 | 0 | 0 | 0/57 |

**New work** 8/53, **regressions** 8, **repairs** 0, **cumulative** 0/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 41.7 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (amber) | 33.2 | None | None | None | — | — | green | 8/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red), on partial 2 | 13.1 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 0 | — | throttled 0%, server peak 35 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red), on partial 2, 3 | 92.9 | None | None | None | — | — | red | 0/31 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 5 | Share a board with others using a link | PARTIAL (red), on partial 2, 3, 4 | 56.1 | None | None | None | — | — | red | 0/36 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 2, 3, 4, 5 | 70.5 | None | None | None | — | — | red | 0/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 35 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 2, 3, 4, 5 | 42.8 | None | None | None | — | — | red | 0/51 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 2, 3, 4, 5 | 49.8 | None | None | None | — | — | red | 0/57 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |

**Totals:** 8 stories, 400 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/8, final acceptance 0/57, stalled 0, partial 4, 12279 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **amber**: gate green, tasks not verified [4, 5, 6, 7, 8] (implementation: [4, 5, 6]), held-out 2/10 (floor 0.0).
- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).
- Story 3, built on partial 2: held-out tests on the partial base 0/21; partial story's tests fixed 0, regressed 2; 0 stub-like lines added to src/.
- **Story 4 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 0/4 (floor 1.0).
- Story 4, built on partial 2, 3: held-out tests on the partial base 0/25; partial story's tests fixed 0, regressed 2; 0 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 0/5 (floor 0.0).
- Story 5, built on partial 2, 3, 4: held-out tests on the partial base 0/30; partial story's tests fixed 0, regressed 2; 0 stub-like lines added to src/.
- Story 7, built on partial 2, 3, 4, 5: held-out tests on the partial base 0/38; partial story's tests fixed 0, regressed 2; 0 stub-like lines added to src/.
- Story 8, built on partial 2, 3, 4, 5: held-out tests on the partial base 0/45; partial story's tests fixed 0, regressed 2; 0 stub-like lines added to src/.
- Story 9, built on partial 2, 3, 4, 5: held-out tests on the partial base 0/51; partial story's tests fixed 0, regressed 2; 1 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6594 / 64 | `BoardViewport.tsx` (354), `camera.ts` (174), `useCamera.ts` (167), `ZoomControls.tsx` (106), `App.tsx` (78), `playwright.config.ts` (42), +15 more |
| 2 | 1 by the agent, + harness snapshot | 2172 / 52 | `board-model.ts` (362), `StickyNote.tsx` (301), `App.tsx` (146), `BoardViewport.tsx` (141), `StickyTextEditor.tsx` (93), `NoteToolbar.tsx` (85), +6 more |
| 3 | harness snapshot (agent left work uncommitted) | 1738 / 38 | `board-room.ts` (163), `connectBoard.ts` (116), `ConnectionStatus.tsx` (83), `board-id.ts` (56), `protocol.ts` (47), `App.tsx` (46), +9 more |
| 4 | harness snapshot (agent left work uncommitted) | 1396 / 118 | `board-store.ts` (288), `board-room.ts` (280), `room-state.ts` (81), `config.ts` (9), `vitest.config.ts` (8), `package.json` (7), +3 more |
| 5 | harness snapshot (agent left work uncommitted) | 2083 / 930 | `App.tsx` (271), `BoardApp.tsx` (216), `board-room.ts` (183), `BoardPage.tsx` (152), `SharePanel.tsx` (133), `index.ts` (120), +15 more |
| 7 | 1 by the agent | 2003 / 378 | `useTransformGesture.ts` (317), `StickyNote.tsx` (265), `BoardViewport.tsx` (264), `geometry.ts` (234), `board-model.ts` (180), `useSelection.ts` (170), +9 more |
| 8 | 1 by the agent | 1644 / 55 | `undo.ts` (116), `UndoButtons.tsx` (61), `NOTES.md` (60), `BoardApp.tsx` (58), `useUndo.ts` (37), `useBoardKeys.ts` (34), +8 more |
| 9 | 1 by the agent | 2467 / 73 | `TextObject.tsx` (286), `BoardApp.tsx` (259), `text.ts` (212), `textLayout.ts` (203), `TextEditor.tsx` (162), `TextToolbar.tsx` (94), +14 more |

### Earlier stories broken or fixed

- **Story 3 broke 8, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (163), `connectBoard.ts` (116), `ConnectionStatus.tsx` (83), `board-id.ts` (56), `protocol.ts` (47), `App.tsx` (46), +9 more.
  - story 1: 6/10 → 0/10; broke 6.
  - story 2: 2/10 → 0/10; broke 2.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
