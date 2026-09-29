# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-opencode

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 19/20 |
| 3 | 0/7 | 0 | 0 | 19/27 |
| 4 | 1/4 | 0 | 0 | 20/31 |
| 5 | 1/5 | 20 | 0 | 1/36 |
| 7 | 0/8 | 0 | 0 | 1/44 |
| 8 | 0/7 | 0 | 0 | 1/51 |
| 9 | 0/6 | 0 | 0 | 1/57 |
| 10 | 0/8 | 0 | 0 | 1/65 |

**New work** 18/61, **regressions** 20, **repairs** 0, **cumulative** 1/65.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 75%, server peak 81 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (amber) | 53.0 | None | None | None | — | — | green | 19/20 |  | 0 / 5 | 1 | — | throttled 89%, server peak 91 GB |
| 3 | See other people's edits appear live on the same board | DONE, on partial 2 | 102.2 | None | None | None | — | — | green | 19/27 |  | 0 / 0 | 3 | — | throttled 83%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 2 | 138.8 | None | None | None | — | — | green | 20/31 |  | 0 / 0 | 5 | — | DEGRADED (power) throttled 89%, server peak 94 GB |
| 5 | Share a board with others using a link | DONE, on partial 2 | 92.6 | None | None | None | — | — | green | 1/36 |  | 0 / 0 | 3 | — | throttled 61%, server peak 94 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 2 | 95.0 | None | None | None | — | — | green | 1/44 |  | 0 / 0 | 4 | — | throttled 93%, server peak 94 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 2 | 87.1 | None | None | None | — | — | green | 1/51 |  | 0 / 0 | 3 | — | throttled 94%, server peak 94 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 2 | 69.9 | None | None | None | — | — | green | 1/57 |  | 0 / 0 | 3 | — | throttled 95%, server peak 94 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE, on partial 2 | 119.3 | None | None | None | — | — | green | 1/65 |  | 0 / 0 | 6 | — | throttled 91%, server peak 94 GB |

**Totals:** 9 stories, 792 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 9/9, final acceptance 1/65, stalled 0, partial 1, 26820 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 2 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8] (implementation: [2, 4, 5, 6]), held-out 10/10 (floor 0.0).
- Story 3, built on partial 2: held-out tests on the partial base 13/21; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.
- Story 4, built on partial 2: held-out tests on the partial base 14/25; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- Story 5, built on partial 2: held-out tests on the partial base 1/30; partial story's tests fixed 0, regressed 10; 2 stub-like lines added to src/.
- Story 7, built on partial 2: held-out tests on the partial base 1/38; partial story's tests fixed 0, regressed 10; 0 stub-like lines added to src/.
- Story 8, built on partial 2: held-out tests on the partial base 1/45; partial story's tests fixed 0, regressed 10; 0 stub-like lines added to src/.
- Story 9, built on partial 2: held-out tests on the partial base 1/51; partial story's tests fixed 0, regressed 10; 0 stub-like lines added to src/.
- Story 10, built on partial 2: held-out tests on the partial base 1/59; partial story's tests fixed 0, regressed 10; 0 stub-like lines added to src/.

> Stories 4 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7691 / 0 | `BoardViewport.tsx` (198), `useCamera.ts` (173), `camera.ts` (129), `ZoomControls.tsx` (95), `NOTES.md` (83), `App.tsx` (52), +14 more |
| 2 | harness snapshot (agent left work uncommitted) | 2201 / 13 | `StickyNote.tsx` (304), `board-model.ts` (186), `App.tsx` (152), `StickyTextEditor.tsx` (140), `StickyText.ts` (100), `NoteToolbar.tsx` (87), +8 more |
| 3 | 3 by the agent | 3698 / 165 | `NOTES.md` (179), `board-room.ts` (145), `useBoardDoc.ts` (109), `connectBoard.ts` (90), `protocol.ts` (75), `ConnectionStatus.tsx` (63), +15 more |
| 4 | 7 by the agent | 4075 / 180 | `board-store.ts` (447), `board-room.ts` (373), `room-state.ts` (135), `useConnectionBadge.ts` (68), `connectBoard.ts` (48), `index.ts` (47), +12 more |
| 5 | 3 by the agent | 3102 / 421 | `SharePanel.tsx` (346), `App.tsx` (244), `BoardApp.tsx` (240), `styles.css` (134), `BoardPage.tsx` (111), `create-board.ts` (94), +18 more |
| 7 | 1 by the agent | 4987 / 353 | `useTransformGesture.ts` (380), `board-model.ts` (317), `StickyNote.tsx` (261), `BoardApp.tsx` (260), `geometry.ts` (245), `useSelection.ts` (214), +8 more |
| 8 | 8 by the agent | 2673 / 196 | `BoardApp.tsx` (258), `undo.ts` (168), `NOTES.md` (125), `useUndo.ts` (89), `UndoButtons.tsx` (87), `StickyTextEditor.tsx` (48), +6 more |
| 9 | 8 by the agent | 2815 / 447 | `text.ts` (246), `TextEditor.tsx` (239), `StickyTextEditor.tsx` (213), `textLayout.ts` (174), `TextObject.tsx` (149), `useTextBoxSync.ts` (125), +16 more |
| 10 | 7 by the agent | 5035 / 145 | `connector.ts` (395), `ConnectorObject.tsx` (370), `shape.ts` (327), `ShapeObject.tsx` (282), `ConnectorTool.tsx` (275), `ShapeTool.tsx` (188), +13 more |

### Earlier stories broken or fixed

- **Story 5 broke 20, fixed 0** earlier held-out tests (docs(5): NOTES.md — test totals, why each suite creates boards the way it does, two product gaps the tests found, clipboard permissions on firefox/webkit, the socket-no-longer-creates rule; test(5): pages, share panel and end-to-end share workflows; feat(5): board API (POST/GET /api/boards), room creation + existence through the BoardRoom, link-only entry rules (404 without creating) + client router, board page check and Share panel). Source files it changed most: `SharePanel.tsx` (346), `App.tsx` (244), `BoardApp.tsx` (240), `styles.css` (134), `BoardPage.tsx` (111), `create-board.ts` (94), +18 more.
  - story 1: 9/10 → 0/10; broke 9.
  - story 2: 10/10 → 0/10; broke 10.
  - story 4: 1/4 → 0/4; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
