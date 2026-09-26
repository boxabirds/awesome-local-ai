# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 40.0 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 13.1 | None | None | None | — | — | red | 6/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 240.0 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 170.6 | None | None | None | — | — | green | 28/31 |  | 0 / 0 | 8 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 73.4 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |

**Totals:** 5 stories, 537 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/5, final acceptance 33/36, stalled 0, partial 1, 11533 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 5/7 (floor 0.0).
- Story 4, built on partial 3: held-out tests on the partial base 9/11; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 14/16; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 5 by the agent | 6788 / 49 | `useCamera.ts` (249), `BoardViewport.tsx` (224), `camera.ts` (214), `styles.css` (129), `NOTES.md` (95), `ZoomControls.tsx` (47), +13 more |
| 2 | 1 by the agent | 459 / 2 | `board-model.ts` (92), `config.ts` (36), `package.json` (3) |
| 3 | 1 by the agent, + harness snapshot | 5847 / 51 | `StickyNote.tsx` (247), `styles.css` (218), `board-model.ts` (213), `board-room.ts` (187), `StickyTextEditor.tsx` (170), `NOTES.md` (156), +22 more |
| 4 | 1 by the agent | 3329 / 110 | `board-room.ts` (519), `board-store.ts` (478), `NOTES.md` (121), `room-state.ts` (116), `test-hooks.ts` (84), `connectBoard.ts` (55), +14 more |
| 5 | 7 by the agent | 2372 / 175 | `board-store.ts` (184), `create-board.ts` (178), `styles.css` (157), `SharePanel.tsx` (136), `board-room.ts` (136), `BoardPage.tsx` (100), +14 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 13** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work); story 2: complete board model and sticky notes UI (prerequisite for story 3)). Source files it changed most: `StickyNote.tsx` (247), `styles.css` (218), `board-model.ts` (213), `board-room.ts` (187), `StickyTextEditor.tsx` (170), `NOTES.md` (156), +22 more.
  - story 1: 6/10 → 10/10; fixed 4
  - story 2: 0/10 → 9/10; fixed 9
