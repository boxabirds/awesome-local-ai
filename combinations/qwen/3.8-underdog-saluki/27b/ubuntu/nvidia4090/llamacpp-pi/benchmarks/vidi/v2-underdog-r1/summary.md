# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 17/20 |
| 3 | 0/7 | 17 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 3/5 | 0 | 19 | 22/36 |
| 7 | 1/8 | 0 | 0 | 23/44 |
| 8 | 5/7 | 1 | 4 | 31/51 |

**New work** 23/47, **regressions** 18, **repairs** 23, **cumulative** 31/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 41.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 0%, server peak 24 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 86.9 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 4 | — | throttled 0%, server peak 24 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 74.6 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 4 | — | throttled 0%, server peak 24 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 49.3 | None | None | None | — | — | red | 0/31 | yes | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | PARTIAL (red), on partial 3 | 237.0 | None | None | None | — | — | red | 22/36 |  | 3 / 0 | 13 | — | throttled 0%, server peak 26 GB |
| 7 | Select, move, resize and delete several objects at once | PARTIAL (red), on partial 3, 5 | 18.0 | None | None | None | — | — | red | 23/44 |  | 0 / 1 | 0 | — | throttled 0%, server peak 26 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | PARTIAL (red), on partial 3, 5, 7 | 240.0 | None | None | None | — | — | red | 31/51 |  | 0 / 0 | 14 | — | throttled 0%, server peak 26 GB |

**Totals:** 7 stories, 747 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/7, final acceptance 31/51, stalled 1, partial 4, 12378 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).
- Story 4, built on partial 3: held-out tests on the partial base 0/11; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 3/5 (floor 0.0).
- Story 5, built on partial 3: held-out tests on the partial base 5/16; partial story's tests fixed 1, regressed 0; 6 stub-like lines added to src/.
- **Story 7 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [2, 8, 10, 11, 12, 13]), held-out 1/8 (floor 0.0).
- Story 7, built on partial 3, 5: held-out tests on the partial base 6/24; partial story's tests fixed 1, regressed 0; 0 stub-like lines added to src/.
- **Story 8 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11] (implementation: [2, 8, 10]), held-out 5/7 (floor 0.0).
- Story 8, built on partial 3, 5, 7: held-out tests on the partial base 14/31; partial story's tests fixed 5, regressed 1; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 5 by the agent | 6326 / 58 | `BoardViewport.tsx` (187), `useCamera.ts` (146), `camera.ts` (144), `styles.css` (95), `App.tsx` (71), `NOTES.md` (51), +14 more |
| 2 | 1 by the agent | 2524 / 20 | `StickyNote.tsx` (217), `board-model.ts` (210), `styles.css` (153), `StickyTextEditor.tsx` (136), `StickyText.ts` (109), `App.tsx` (99), +10 more |
| 3 | 1 by the agent, + harness snapshot | 1878 / 48 | `protocol.ts` (119), `index.ts` (67), `board-id.ts` (45), `cloudflare-workers.d.ts` (31), `vitest.config.ts` (30), `board-room.ts` (22), +5 more |
| 4 | harness snapshot (agent left work uncommitted) | 1028 / 23 | `board-store.ts` (294), `room-state.ts` (97), `cloudflare-workers.d.ts` (51), `cloudflare-test.d.ts` (36), `PROGRESS.md` (32), `config.ts` (18), +4 more |
| 5 | harness snapshot (agent left work uncommitted) | 2715 / 290 | `board-room.ts` (368), `board-store.ts` (276), `Board.tsx` (196), `App.tsx` (177), `styles.css` (175), `SharePanel.tsx` (156), +21 more |
| 7 | — | 0 / 0 | — |
| 8 | harness snapshot (agent left work uncommitted) | 5018 / 357 | `useTransformGesture.ts` (299), `board-model.ts` (250), `geometry.ts` (204), `Board.tsx` (194), `StickyNote.tsx` (189), `useBoardKeys.ts` (161), +20 more |

### Earlier stories broken or fixed

- **Story 3 broke 17, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work); story 3 task 1: board id and protocol decode unit tests (TC-01 to TC-03)). Source files it changed most: `protocol.ts` (119), `index.ts` (67), `board-id.ts` (45), `cloudflare-workers.d.ts` (31), `vitest.config.ts` (30), `board-room.ts` (22), +5 more.
  - story 1: 9/10 → 0/10; broke 9.
  - story 2: 8/10 → 0/10; broke 8.
- **Story 5 broke 0, fixed 19** earlier held-out tests (harness: snapshot after story 5 (uncommitted agent work)). Source files it changed most: `board-room.ts` (368), `board-store.ts` (276), `Board.tsx` (196), `App.tsx` (177), `styles.css` (175), `SharePanel.tsx` (156), +21 more.
  - story 1: 0/10 → 9/10; fixed 9
  - story 2: 0/10 → 8/10; fixed 8
  - story 3: 0/7 → 1/7; fixed 1
  - story 4: 0/4 → 1/4; fixed 1
- **Story 8 broke 1, fixed 4** earlier held-out tests (harness: snapshot after story 8 (uncommitted agent work)). Source files it changed most: `useTransformGesture.ts` (299), `board-model.ts` (250), `geometry.ts` (204), `Board.tsx` (194), `StickyNote.tsx` (189), `useBoardKeys.ts` (161), +20 more.
  - story 7: 1/8 → 4/8; broke 1; fixed 4.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
