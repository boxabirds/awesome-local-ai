# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |

**New work** 21/23, **regressions** 0, **repairs** 0, **cumulative** 25/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 63.7 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 69%, server peak 90 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 62.8 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 80%, server peak 92 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.9 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 6 | — | throttled 85%, server peak 95 GB |

**Totals:** 3 stories, 295 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 25/27, stalled 0, partial 0, 9823 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6952 / 45 | `BoardViewport.tsx` (241), `camera.ts` (177), `useCamera.ts` (168), `styles.css` (158), `NOTES.md` (101), `App.tsx` (50), +13 more |
| 2 | 4 by the agent | 3527 / 76 | `StickyNote.tsx` (272), `board-model.ts` (265), `styles.css` (218), `StickyText.ts` (159), `StickyTextEditor.tsx` (151), `App.tsx` (129), +8 more |
| 3 | 6 by the agent | 7209 / 1738 | `board-room.ts` (212), `connectBoard.ts` (175), `NOTES.md` (142), `useBoardDoc.ts` (135), `protocol.ts` (97), `index.ts` (92), +17 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
