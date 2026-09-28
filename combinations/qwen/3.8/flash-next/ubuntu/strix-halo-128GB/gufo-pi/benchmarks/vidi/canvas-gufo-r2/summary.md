# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 48.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 47.9 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 40.2 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 123.2 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | PARTIAL (red) | 20.5 | None | None | None | — | — | red | 33/36 |  | 0 / 5 | 0 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 5 | 65.6 | None | None | None | — | — | red | 39/44 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 5 | 29.6 | None | None | None | — | — | red | 46/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 5 | 63.2 | None | None | None | — | — | red | 48/57 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |

**Totals:** 8 stories, 439 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/8, final acceptance 48/57, stalled 0, partial 1, 17495 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 5 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 4/5 (floor 1.0).
- Story 7, built on partial 5: held-out tests on the partial base 10/13; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 5: held-out tests on the partial base 17/20; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 5: held-out tests on the partial base 19/26; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6939 / 64 | `BoardViewport.tsx` (319), `useCamera.ts` (183), `camera.ts` (171), `styles.css` (154), `NOTES.md` (132), `ZoomControls.tsx` (97), +14 more |
| 2 | 1 by the agent | 2419 / 17 | `StickyNote.tsx` (255), `App.tsx` (202), `styles.css` (201), `board-model.ts` (165), `StickyText.ts` (124), `StickyTextEditor.tsx` (120), +6 more |
| 3 | 3 by the agent | 3844 / 113 | `board-room.ts` (142), `connectBoard.ts` (113), `protocol.ts` (60), `NOTES.md` (49), `index.ts` (43), `ConnectionStatus.tsx` (40), +13 more |
| 4 | 5 by the agent | 3536 / 153 | `board-room.ts` (468), `board-store.ts` (399), `NOTES.md` (125), `test-hooks.ts` (120), `room-state.ts` (100), `connectBoard.ts` (44), +11 more |
| 5 | harness snapshot (agent left work uncommitted) | 1616 / 59 | `SharePanel.tsx` (154), `board-store.ts` (89), `App.tsx` (81), `BoardPage.tsx` (79), `create-board.ts` (75), `api.ts` (56), +9 more |
| 7 | 1 by the agent | 2710 / 403 | `useTransformGesture.ts` (319), `App.tsx` (274), `board-model.ts` (257), `StickyNote.tsx` (245), `geometry.ts` (209), `useSelection.ts` (131), +10 more |
| 8 | 1 by the agent | 1479 / 21 | `undo.ts` (117), `UndoButtons.tsx` (71), `App.tsx` (46), `StickyTextEditor.tsx` (43), `useBoardKeys.ts` (42), `useUndo.ts` (39), +4 more |
| 9 | 1 by the agent | 2356 / 238 | `TextEditor.tsx` (174), `text.ts` (164), `StickyTextEditor.tsx` (160), `textLayout.ts` (136), `TextObject.tsx` (125), `App.tsx` (86), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
