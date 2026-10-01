# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 4/7 | 0 | 0 | 22/27 |
| 4 | 4/4 | 0 | 0 | 26/31 |
| 5 | 5/5 | 0 | 0 | 31/36 |

**New work** 27/32, **regressions** 0, **repairs** 0, **cumulative** 31/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 37.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 41.7 | None | None | None | — | — | red | 18/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 113.9 | None | None | None | — | — | red | 22/27 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 31.2 | None | None | None | — | — | red | 26/31 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 54.2 | None | None | None | — | — | red | 31/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 5 stories, 278 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/5, final acceptance 31/36, stalled 0, partial 0, 11242 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 7101 / 28 | `useCamera.ts` (236), `BoardViewport.tsx` (228), `styles.css` (177), `camera.ts` (174), `NOTES.md` (96), `ZoomControls.tsx` (70), +14 more |
| 2 | 2 by the agent, + harness snapshot | 3106 / 47 | `StickyNote.tsx` (303), `board-model.ts` (250), `styles.css` (191), `App.tsx` (124), `StickyText.ts` (115), `StickyTextEditor.tsx` (104), +9 more |
| 3 | 1 by the agent | 3354 / 30 | `board-room.ts` (172), `connectBoard.ts` (100), `protocol.ts` (86), `StickyTextEditor.tsx` (53), `index.ts` (39), `board-id.ts` (32), +14 more |
| 4 | 1 by the agent | 2309 / 125 | `board-room.ts` (342), `board-store.ts` (169), `room-state.ts` (67), `persistence.ts` (44), `connectBoard.ts` (40), `test-hooks.ts` (38), +9 more |
| 5 | 1 by the agent | 1756 / 34 | `SharePanel.tsx` (154), `styles.css` (122), `board-room.ts` (104), `BoardPage.tsx` (90), `test-hooks.ts` (59), `index.ts` (57), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
