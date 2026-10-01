# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 0/7 | 17 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 1/5 | 0 | 0 | 1/36 |
| 7 | 0/8 | 0 | 0 | 1/44 |
| 8 | 0/7 | 0 | 0 | 1/51 |

**New work** 14/47, **regressions** 17, **repairs** 0, **cumulative** 1/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 10.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 36.0 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 23.4 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 20 GB |
| 4 | Return to a board and find everything as it was left | DONE | 65.3 | None | None | None | — | — | red | 0/31 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 14.2 | None | None | None | — | — | red | 1/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 16.1 | None | None | None | — | — | red | 1/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 56.7 | None | None | None | — | — | red | 1/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |

**Totals:** 7 stories, 222 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/7, final acceptance 1/51, stalled 0, partial 0, 14116 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6685 / 0 | `BoardViewport.tsx` (215), `useCamera.ts` (138), `camera.ts` (129), `ZoomControls.tsx` (99), `App.tsx` (75), `package.json` (33), +13 more |
| 2 | 1 by the agent | 2356 / 8 | `StickyNote.tsx` (256), `board-model.ts` (166), `StickyTextEditor.tsx` (123), `App.tsx` (82), `StickyText.ts` (75), `NoteToolbar.tsx` (71), +7 more |
| 3 | 1 by the agent | 3220 / 37 | `board-room.ts` (142), `connectBoard.ts` (103), `protocol.ts` (57), `ConnectionStatus.tsx` (56), `index.ts` (43), `App.tsx` (31), +8 more |
| 4 | 1 by the agent | 2890 / 63 | `board-room.ts` (430), `board-store.ts` (209), `kv-fallback-store.ts` (152), `room-state.ts` (62), `test-hooks.ts` (46), `connectBoard.ts` (17), +9 more |
| 5 | 1 by the agent | 2114 / 318 | `App.tsx` (191), `SharePanel.tsx` (173), `BoardContent.tsx` (169), `board-store.ts` (169), `NOTES.md` (146), `BoardPage.tsx` (98), +10 more |
| 7 | 1 by the agent | 2587 / 307 | `useTransformGesture.ts` (225), `board-model.ts` (219), `geometry.ts` (188), `StickyNote.tsx` (167), `BoardContent.tsx` (135), `NOTES.md` (132), +9 more |
| 8 | 1 by the agent | 1467 / 33 | `undo.ts` (85), `StickyTextEditor.tsx` (58), `UndoButtons.tsx` (54), `useUndo.ts` (38), `BoardContent.tsx` (35), `useBoardKeys.ts` (31), +6 more |

### Earlier stories broken or fixed

- **Story 3 broke 17, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (142), `connectBoard.ts` (103), `protocol.ts` (57), `ConnectionStatus.tsx` (56), `index.ts` (43), `App.tsx` (31), +8 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 7/10 → 0/10; broke 7.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
