# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 8/10 | 0 | 0 | 16/20 |
| 3 | 0/7 | 16 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 2/5 | 0 | 0 | 2/36 |
| 7 | 0/8 | 0 | 0 | 2/44 |

**New work** 15/40, **regressions** 16, **repairs** 0, **cumulative** 2/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 124.7 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 6 | — | throttled 0%, server peak 23 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 65.0 | None | None | None | — | — | green | 16/20 |  | 0 / 1 | 3 | — | throttled 0%, server peak 25 GB |
| 3 | See other people's edits appear live on the same board | DONE | 232.0 | None | None | None | — | — | red | 0/27 | yes | 0 / 0 | 15 | — | throttled 0%, server peak 25 GB |
| 4 | Return to a board and find everything as it was left | DONE | 201.6 | None | None | None | — | — | red | 0/31 | yes | 0 / 0 | 12 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 106.3 | None | None | None | — | — | red | 2/36 | yes | 0 / 0 | 6 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 150.8 | None | None | None | — | — | red | 2/44 | yes | 1 / 1 | 8 | — | throttled 0%, server peak 25 GB |

**Totals:** 6 stories, 880 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/6, final acceptance 2/44, stalled 4, partial 0, 20598 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 7399 / 82 | `BoardViewport.tsx` (254), `useCamera.ts` (192), `camera.ts` (163), `index.css` (147), `playwright.config.ts` (128), `ZoomControls.tsx` (96), +16 more |
| 2 | 1 by the agent | 2818 / 24 | `StickyNote.tsx` (256), `board-model.ts` (208), `index.css` (183), `StickyTextEditor.tsx` (134), `StickyText.ts` (92), `App.tsx` (89), +9 more |
| 3 | harness snapshot (agent left work uncommitted) | 11397 / 172 | `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more |
| 4 | 1 by the agent, + harness snapshot | 1811 / 57 | `board-store.ts` (239), `board-store-core.ts` (54), `room-state.ts` (52), `config.ts` (9), `protocol.ts` (8), `cloudflare-test.d.ts` (7), +1 more |
| 5 | harness snapshot (agent left work uncommitted) | 1951 / 1380 | `board-room.ts` (292), `index.css` (169), `SharePanel.tsx` (157), `board-store.ts` (133), `index.ts` (78), `BoardPage.tsx` (75), +14 more |
| 7 | harness snapshot (agent left work uncommitted) | 4091 / 398 | `useTransformGesture.ts` (348), `board-model.ts` (305), `StickyNote.tsx` (249), `BoardCanvas.tsx` (210), `geometry.ts` (165), `useSelection.ts` (143), +12 more |

### Earlier stories broken or fixed

- **Story 3 broke 16, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more.
  - story 1: 8/10 → 0/10; broke 8.
  - story 2: 8/10 → 0/10; broke 8.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
