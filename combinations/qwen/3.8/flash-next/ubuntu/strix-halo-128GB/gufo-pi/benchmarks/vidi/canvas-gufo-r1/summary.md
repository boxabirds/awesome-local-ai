# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 34.2 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 53.8 | None | None | None | — | — | green | 23/27 |  | 0 / 5 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (amber), on partial 3 | 75.4 | None | None | None | — | — | green | 25/31 |  | 0 / 5 | 2 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | PARTIAL (red), on partial 3, 4 | 40.4 | None | None | None | — | — | red | 1/36 |  | 0 / 5 | 1 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3, 4, 5 | 55.4 | None | None | None | — | — | green | 38/44 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 3, 4, 5 | 23.8 | None | None | None | — | — | green | 43/51 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 3, 4, 5 | 25.8 | None | None | None | — | — | green | 47/57 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 8 stories, 343 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/8, final acceptance 47/57, stalled 0, partial 3, 16332 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 5/7 (floor 0.0).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 2/4 (floor 0.25).
- Story 4, built on partial 3: held-out tests on the partial base 7/11; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 1/5 (floor 1.0).
- Story 5, built on partial 3, 4: held-out tests on the partial base 1/16; partial story's tests fixed 0, regressed 7; 4 stub-like lines added to src/.
- Story 7, built on partial 3, 4, 5: held-out tests on the partial base 20/24; partial story's tests fixed 4, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 3, 4, 5: held-out tests on the partial base 25/31; partial story's tests fixed 4, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 3, 4, 5: held-out tests on the partial base 29/37; partial story's tests fixed 4, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6551 / 0 | `BoardViewport.tsx` (269), `useCamera.ts` (149), `styles.css` (145), `camera.ts` (126), `NOTES.md` (90), `playwright.config.ts` (67), +13 more |
| 2 | 1 by the agent | 2431 / 16 | `StickyNote.tsx` (295), `board-model.ts` (162), `App.tsx` (146), `styles.css` (136), `StickyTextEditor.tsx` (129), `StickyText.ts` (108), +8 more |
| 3 | harness snapshot (agent left work uncommitted) | 2951 / 161 | `NOTES.md` (179), `board-room.ts` (124), `connectBoard.ts` (96), `protocol.ts` (47), `ConnectionStatus.tsx` (39), `index.ts` (39), +15 more |
| 4 | harness snapshot (agent left work uncommitted) | 2516 / 69 | `board-room.ts` (334), `board-store.ts` (167), `room-state.ts` (86), `test-hooks.ts` (47), `connectBoard.ts` (42), `board-store-utils.ts` (39), +16 more |
| 5 | harness snapshot (agent left work uncommitted) | 1880 / 302 | `App.tsx` (187), `styles.css` (148), `BoardApp.tsx` (132), `SharePanel.tsx` (125), `board-room.ts` (106), `BoardPage.tsx` (72), +13 more |
| 7 | 1 by the agent | 3120 / 336 | `useTransformGesture.ts` (302), `board-model.ts` (231), `StickyNote.tsx` (214), `geometry.ts` (189), `BoardApp.tsx` (182), `SelectionOverlay.tsx` (154), +15 more |
| 8 | 1 by the agent | 1779 / 17 | `undo.ts` (99), `BoardApp.tsx` (51), `useUndo.ts` (49), `useBoardKeys.ts` (46), `NOTES.md` (44), `StickyTextEditor.tsx` (43), +5 more |
| 9 | 1 by the agent | 2265 / 277 | `BoardApp.tsx` (171), `TextEditor.tsx` (167), `StickyTextEditor.tsx` (166), `text.ts` (163), `TextObject.tsx` (150), `textLayout.ts` (133), +16 more |

### Earlier stories broken or fixed

- **Story 5 broke 25, fixed 0** earlier held-out tests (harness: snapshot after story 5 (uncommitted agent work)). Source files it changed most: `App.tsx` (187), `styles.css` (148), `BoardApp.tsx` (132), `SharePanel.tsx` (125), `board-room.ts` (106), `BoardPage.tsx` (72), +13 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 8/10 → 0/10; broke 8.
  - story 3: 5/7 → 0/7; broke 5.
  - story 4: 2/4 → 0/4; broke 2.
- **Story 7 broke 0, fixed 29** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (302), `board-model.ts` (231), `StickyNote.tsx` (214), `geometry.ts` (189), `BoardApp.tsx` (182), `SelectionOverlay.tsx` (154), +15 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 8/10; fixed 8
  - story 3: 0/7 → 5/7; fixed 5
  - story 4: 0/4 → 2/4; fixed 2
  - story 5: 1/5 → 5/5; fixed 4

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
