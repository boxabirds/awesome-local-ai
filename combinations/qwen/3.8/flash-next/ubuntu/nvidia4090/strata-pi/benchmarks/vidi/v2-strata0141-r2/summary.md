# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 0 | 35/36 |

**New work** 31/32, **regressions** 0, **repairs** 0, **cumulative** 35/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 50.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 87.1 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (green) | 240.0 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (amber), on partial 3 | 240.0 | None | None | None | — | — | green | 30/31 |  | 0 / 1 | 9 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | PARTIAL (green), on partial 3, 4 | 91.9 | None | None | None | — | — | green | 35/36 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |

**Totals:** 5 stories, 709 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 35/36, stalled 0, partial 3, 17058 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **green**: gate green, tasks not verified none (implementation: none), held-out 6/7 (floor 0.571).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [7, 8, 9] (implementation: [7]), held-out 4/4 (floor 1.0).
- Story 4, built on partial 3: held-out tests on the partial base 10/11; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **green**: gate green, tasks not verified none (implementation: none), held-out 5/5 (floor 0.0).
- Story 5, built on partial 3, 4: held-out tests on the partial base 15/16; partial story's tests fixed 0, regressed 0; 6 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6902 / 28 | `useCamera.ts` (302), `BoardViewport.tsx` (249), `camera.ts` (180), `styles.css` (179), `playwright.config.ts` (142), `NOTES.md` (92), +15 more |
| 2 | 2 by the agent | 4613 / 53 | `StickyNote.tsx` (412), `board-model.ts` (345), `styles.css` (232), `StickyTextEditor.tsx` (183), `StickyText.ts` (150), `App.tsx` (110), +10 more |
| 3 | 5 by the agent, + harness snapshot | 4616 / 202 | `StickyTextEditor.tsx` (351), `board-room.ts` (204), `connectBoard.ts` (155), `StickyText.ts` (144), `protocol.ts` (115), `PROGRESS.md` (62), +16 more |
| 4 | 6 by the agent | 4486 / 696 | `board-store.ts` (872), `board-room.ts` (293), `node-replay2.ts` (89), `room-state.ts` (89), `seed-probe.mjs` (77), `node-replay3.ts` (44), +10 more |
| 5 | 1 by the agent | 2965 / 234 | `App.tsx` (197), `SharePanel.tsx` (185), `BoardUI.tsx` (166), `styles.css` (151), `index.ts` (99), `BoardPage.tsx` (98), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
