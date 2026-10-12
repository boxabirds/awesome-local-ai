# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 17/20 |
| 3 | 0/7 | 17 | 0 | 0/27 |

**New work** 14/23, **regressions** 17, **repairs** 0, **cumulative** 0/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 41.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 0%, server peak 24 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 86.9 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 4 | — | throttled 0%, server peak 24 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 74.6 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 4 | — | throttled 0%, server peak 24 GB |

**Totals:** 3 stories, 203 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 0/27, stalled 0, partial 1, 4368 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 5 by the agent | 6326 / 58 | `BoardViewport.tsx` (187), `useCamera.ts` (146), `camera.ts` (144), `styles.css` (95), `App.tsx` (71), `NOTES.md` (51), +14 more |
| 2 | 1 by the agent | 2524 / 20 | `StickyNote.tsx` (217), `board-model.ts` (210), `styles.css` (153), `StickyTextEditor.tsx` (136), `StickyText.ts` (109), `App.tsx` (99), +10 more |
| 3 | 1 by the agent, + harness snapshot | 1878 / 48 | `protocol.ts` (119), `index.ts` (67), `board-id.ts` (45), `cloudflare-workers.d.ts` (31), `vitest.config.ts` (30), `board-room.ts` (22), +5 more |

### Earlier stories broken or fixed

- **Story 3 broke 17, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work); story 3 task 1: board id and protocol decode unit tests (TC-01 to TC-03)). Source files it changed most: `protocol.ts` (119), `index.ts` (67), `board-id.ts` (45), `cloudflare-workers.d.ts` (31), `vitest.config.ts` (30), `board-room.ts` (22), +5 more.
  - story 1: 9/10 → 0/10; broke 9.
  - story 2: 8/10 → 0/10; broke 8.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
