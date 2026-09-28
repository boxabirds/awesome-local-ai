# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 10.4 | None | None | None | — | — | green | 0/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 33.5 | None | None | None | — | — | red | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 19 GB |
| 3 | See other people's edits appear live on the same board | DONE | 91.7 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 4 | Return to a board and find everything as it was left | DONE | 134.8 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 26 GB |
| 5 | Share a board with others using a link | DONE | 99.9 | None | None | None | — | — | red | 35/36 |  | 0 / 0 (ended in error) | 3 | — | throttled 0%, server peak 26 GB MEMORY-ABORT |

**Totals:** 5 stories, 370 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/5, final acceptance 35/36, stalled 0, partial 0, 10401 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7615 / 0 | `BoardViewport.tsx` (219), `useCamera.ts` (121), `camera.ts` (115), `ZoomControls.tsx` (97), `App.tsx` (43), `playwright.config.ts` (33), +13 more |
| 2 | 1 by the agent | 2335 / 7 | `StickyNote.tsx` (272), `board-model.ts` (189), `StickyTextEditor.tsx` (174), `App.tsx` (148), `NoteToolbar.tsx` (102), `StickyText.ts` (96), +6 more |
| 3 | 1 by the agent | 3768 / 42 | `board-room.ts` (165), `connectBoard.ts` (149), `protocol.ts` (81), `useBoardDoc.ts` (52), `ConnectionStatus.tsx` (50), `App.tsx` (48), +15 more |
| 4 | 1 by the agent | 2700 / 226 | `board-store.ts` (323), `board-room.ts` (294), `test-ops.ts` (228), `room-state.ts` (117), `App.tsx` (57), `connectBoard.ts` (55), +13 more |
| 5 | harness snapshot (agent left work uncommitted) | 2444 / 362 | `App.tsx` (276), `Board.tsx` (233), `SharePanel.tsx` (211), `create-board.ts` (108), `BoardPage.tsx` (89), `NotFoundPage.tsx` (72), +15 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 20** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (165), `connectBoard.ts` (149), `protocol.ts` (81), `useBoardDoc.ts` (52), `ConnectionStatus.tsx` (50), `App.tsx` (48), +15 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
