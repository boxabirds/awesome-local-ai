# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 0/10 | 0 | 0 | 6/20 |
| 3 | 0/7 | 6 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 3/5 | 0 | 0 | 3/36 |

**New work** 9/32, **regressions** 6, **repairs** 0, **cumulative** 3/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 72.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 3 | — | throttled 0%, server peak 23 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (red) | 42.6 | None | None | None | — | — | red | 6/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 23 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red), on partial 2 | 78.1 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 5 | — | throttled 0%, server peak 25 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red), on partial 2, 3 | 49.5 | None | None | None | — | — | red | 0/31 |  | 0 / 1 | 2 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | PARTIAL (red), on partial 2, 3, 4 | 84.7 | None | None | None | — | — | red | 3/36 |  | 0 / 1 | 5 | — | throttled 0%, server peak 25 GB |

**Totals:** 5 stories, 328 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/5, final acceptance 3/36, stalled 0, partial 4, 7011 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [4, 5, 6, 7, 8] (implementation: [4, 5, 6]), held-out 0/10 (floor 0.0).
- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).
- Story 3, built on partial 2: held-out tests on the partial base 0/21; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 4 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 0/4 (floor 0.25).
- Story 4, built on partial 2, 3: held-out tests on the partial base 0/25; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 5 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 4, 5]), held-out 3/5 (floor 0.0).
- Story 5, built on partial 2, 3, 4: held-out tests on the partial base 3/30; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 5694 / 104 | `BoardViewport.tsx` (243), `useCamera.ts` (202), `camera.ts` (168), `NOTES.md` (128), `ZoomControls.tsx` (89), `App.tsx` (66), +13 more |
| 2 | 4 by the agent, + harness snapshot | 1742 / 84 | `StickyNote.tsx` (274), `board-model.ts` (223), `StickyTextEditor.tsx` (191), `StickyText.ts` (125), `BoardViewport.tsx` (86), `App.tsx` (70), +7 more |
| 3 | harness snapshot (agent left work uncommitted) | 2722 / 19 | `board-room.ts` (149), `connectBoard.ts` (111), `index.ts` (75), `useNoteKeyboard.ts` (67), `exp-test.ts` (53), `protocol.ts` (53), +19 more |
| 4 | 1 by the agent, + harness snapshot | 1258 / 73 | `board-room.ts` (291), `board-store.ts` (273), `room-state.ts` (85), `config.ts` (9), `protocol.ts` (8), `index.ts` (6), +1 more |
| 5 | harness snapshot (agent left work uncommitted) | 1688 / 141 | `SharePanel.tsx` (137), `App.tsx` (114), `index.ts` (82), `BoardPage.tsx` (80), `BoardApp.tsx` (73), `HomePage.tsx` (58), +9 more |

### Earlier stories broken or fixed

- **Story 3 broke 6, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (149), `connectBoard.ts` (111), `index.ts` (75), `useNoteKeyboard.ts` (67), `exp-test.ts` (53), `protocol.ts` (53), +19 more.
  - story 1: 6/10 → 0/10; broke 6.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
