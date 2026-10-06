# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 0/10 | 0 | 0 | 6/20 |
| 3 | 0/7 | 0 | 0 | 6/27 |
| 4 | 1/4 | 0 | 0 | 7/31 |

**New work** 7/27, **regressions** 0, **repairs** 0, **cumulative** 7/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 27.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 116.5 | None | None | None | — | — | green | 6/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 240.0 | None | None | None | — | — | red | 6/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red), on partial 3 | 240.0 | None | None | None | — | — | red | 7/31 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |

**Totals:** 4 stories, 624 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/4, final acceptance 7/31, stalled 0, partial 2, 12409 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 7, 8, 9] (implementation: [4]), held-out 0/7 (floor 0.571).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 6, 7, 8, 9] (implementation: [4, 7]), held-out 1/4 (floor 1.0).
- Story 4, built on partial 3: held-out tests on the partial base 1/11; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6738 / 34 | `useCamera.ts` (262), `BoardViewport.tsx` (244), `styles.css` (165), `camera.ts` (159), `NOTES.md` (98), `playwright.config.ts` (84), +15 more |
| 2 | 8 by the agent | 3727 / 72 | `StickyNote.tsx` (366), `board-model.ts` (324), `styles.css` (193), `StickyText.ts` (164), `StickyTextEditor.tsx` (150), `App.tsx` (148), +9 more |
| 3 | 2 by the agent, + harness snapshot | 20972 / 268 | `worker-configuration.d.ts` (16187), `board-room.ts` (197), `connection-state.ts` (104), `protocol.ts` (104), `connectBoard.ts` (65), `StickyTextEditor.tsx` (52), +22 more |
| 4 | 3 by the agent, + harness snapshot | 3271 / 145 | `board-store.ts` (485), `board-room.ts` (421), `room-state.ts` (148), `NOTES.md` (91), `playwright.persistence.config.ts` (37), `config.ts` (21), +4 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
