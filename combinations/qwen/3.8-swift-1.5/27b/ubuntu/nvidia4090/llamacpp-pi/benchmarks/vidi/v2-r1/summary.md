# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 0/7 | 19 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 0/5 | 0 | 0 | 0/36 |

**New work** 15/32, **regressions** 19, **repairs** 0, **cumulative** 0/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 12.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 12.7 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 20 GB |
| 3 | See other people's edits appear live on the same board | DONE | 33.0 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 2 | — | throttled 0%, server peak 24 GB |
| 4 | Return to a board and find everything as it was left | DONE | 30.4 | None | None | None | — | — | red | 0/31 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 97.7 | None | None | None | — | — | red | 0/36 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |

**Totals:** 5 stories, 186 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/5, final acceptance 0/36, stalled 0, partial 0, 9253 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6648 / 0 | `BoardViewport.tsx` (238), `useCamera.ts` (122), `camera.ts` (111), `ZoomControls.tsx` (97), `App.tsx` (56), `playwright.config.ts` (35), +13 more |
| 2 | 1 by the agent | 2067 / 7 | `StickyNote.tsx` (241), `board-model.ts` (139), `StickyTextEditor.tsx` (126), `App.tsx` (124), `StickyText.ts` (76), `NoteToolbar.tsx` (69), +7 more |
| 3 | 1 by the agent | 3080 / 6 | `room-core.ts` (108), `ConnectionStatus.tsx` (83), `connectBoard.ts` (74), `types.d.ts` (69), `index.ts` (43), `protocol.ts` (42), +8 more |
| 4 | 1 by the agent | 2341 / 27 | `board-room.ts` (365), `board-store.ts` (231), `index.ts` (109), `room-state.ts` (56), `connectBoard.ts` (55), `App.tsx` (30), +7 more |
| 5 | 1 by the agent | 2282 / 434 | `App.tsx` (218), `Board.tsx` (198), `SharePanel.tsx` (193), `board-room.ts` (166), `BoardPage.tsx` (107), `NOTES.md` (93), +16 more |

### Earlier stories broken or fixed

- **Story 3 broke 19, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `room-core.ts` (108), `ConnectionStatus.tsx` (83), `connectBoard.ts` (74), `types.d.ts` (69), `index.ts` (43), `protocol.ts` (42), +8 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 9/10 → 0/10; broke 9.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
