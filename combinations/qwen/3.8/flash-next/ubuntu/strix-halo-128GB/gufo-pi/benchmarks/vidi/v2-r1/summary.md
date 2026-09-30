# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 0/5 | 29 | 0 | 0/36 |
| 7 | 0/8 | 0 | 0 | 0/44 |

**New work** 25/40, **regressions** 29, **repairs** 0, **cumulative** 0/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 51.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 80.2 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 44.8 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 47.0 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 32.4 | None | None | None | — | — | green | 0/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 28.5 | None | None | None | — | — | green | 0/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 6 stories, 284 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/6, final acceptance 0/44, stalled 0, partial 0, 15505 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 5881 / 20 | `useCamera.ts` (242), `BoardViewport.tsx` (205), `styles.css` (159), `camera.ts` (148), `NOTES.md` (118), `ZoomControls.tsx` (77), +15 more |
| 2 | 1 by the agent | 4362 / 21 | `StickyNote.tsx` (332), `board-model.ts` (261), `styles.css` (199), `StickyTextEditor.tsx` (150), `StickyText.ts` (145), `App.tsx` (122), +11 more |
| 3 | 1 by the agent | 3725 / 94 | `board-room.ts` (272), `cloudflare-workers.d.ts` (146), `connectBoard.ts` (107), `protocol.ts` (51), `ConnectionStatus.tsx` (45), `App.tsx` (34), +8 more |
| 4 | 1 by the agent | 2420 / 83 | `board-room.ts` (393), `board-store.ts` (259), `room-state.ts` (84), `test-hooks.ts` (79), `App.tsx` (26), `connectBoard.ts` (23), +9 more |
| 5 | 1 by the agent | 1615 / 60 | `SharePanel.tsx` (186), `BoardPage.tsx` (91), `board-store.ts` (88), `board-room.ts` (68), `index.ts` (58), `NotFoundPage.tsx` (57), +10 more |
| 7 | 1 by the agent | 2802 / 287 | `useTransformGesture.ts` (438), `geometry.ts` (222), `StickyNote.tsx` (205), `board-model.ts` (198), `App.tsx` (174), `useSelection.ts` (141), +8 more |

### Earlier stories broken or fixed

- **Story 5 broke 29, fixed 0** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `SharePanel.tsx` (186), `BoardPage.tsx` (91), `board-store.ts` (88), `board-room.ts` (68), `index.ts` (58), `NotFoundPage.tsx` (57), +10 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 10/10 → 0/10; broke 10.
  - story 3: 5/7 → 0/7; broke 5.
  - story 4: 4/4 → 0/4; broke 4.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
