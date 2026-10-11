# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/strata-pi

Model `qwen3.8-flash-next-strata`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 5/7 | 0 | 0 | 22/27 |
| 4 | 4/4 | 0 | 0 | 26/31 |
| 5 | 5/5 | 0 | 0 | 31/36 |

**New work** 27/32, **regressions** 0, **repairs** 0, **cumulative** 31/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 51.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 20.6 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 64.9 | None | None | None | — | — | green | 22/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (green) | 45.0 | None | None | None | — | — | green | 26/31 |  | 0 / 1 | 1 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 49.7 | None | None | None | — | — | green | 31/36 |  | 0 / 1 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 5 stories, 231 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 31/36, stalled 0, partial 1, 10863 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **green**: gate green, tasks not verified none (implementation: none), held-out 4/4 (floor 1.0).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 4 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6265 / 7 | `BoardViewport.tsx` (224), `useCamera.ts` (164), `styles.css` (160), `camera.ts` (133), `NOTES.md` (124), `Board.tsx` (82), +15 more |
| 2 | 1 by the agent | 2651 / 25 | `StickyNote.tsx` (261), `StickyTextEditor.tsx` (180), `App.tsx` (168), `styles.css` (155), `board-model.ts` (152), `StickyText.ts` (124), +10 more |
| 3 | 1 by the agent | 2096 / 176 | `board-room.ts` (189), `NOTES.md` (183), `types.d.ts` (106), `connectBoard.ts` (97), `protocol.ts` (66), `index.ts` (41), +12 more |
| 4 | 1 by the agent | 2358 / 124 | `board-room.ts` (400), `board-store.ts` (234), `room-state.ts` (77), `PROGRESS.md` (76), `connectBoard.ts` (36), `config.ts` (23), +11 more |
| 5 | 1 by the agent | 1970 / 53 | `styles.css` (178), `SharePanel.tsx` (149), `board-room.ts` (128), `board-store.ts` (107), `BoardPage.tsx` (83), `index.ts` (61), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
