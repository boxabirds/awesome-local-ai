# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client opencode 1.18.30, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

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
| 1 | Pan and zoom around an infinite board | DONE | 30.1 | None | None | None | — | — | green | 6/6 |  | 1 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 52.9 | None | None | None | — | — | red | 20/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 124.1 | None | None | None | — | — | green | 26/27 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (amber) | 241.1 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 69.5 | None | None | None | — | — | green | 35/36 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |

**Totals:** 5 stories, 518 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/5, final acceptance 35/36, stalled 0, partial 1, 8845 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 4/4 (floor 1.0).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 5 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 5087 / 40 | `BoardViewport.tsx` (214), `useCamera.ts` (125), `camera.ts` (124), `ZoomControls.tsx` (72), `playwright.config.ts` (70), `package.json` (34), +15 more |
| 2 | 1 by the agent | 1991 / 16 | `StickyNote.tsx` (193), `board-model.ts` (157), `StickyTextEditor.tsx` (117), `NoteToolbar.tsx` (94), `BoardViewport.tsx` (87), `StickyText.ts` (74), +10 more |
| 3 | 4 by the agent | 3684 / 1342 | `board-room.ts` (147), `connectBoard.ts` (114), `protocol.ts` (94), `App.tsx` (54), `ConnectionStatus.tsx` (46), `StickyTextEditor.tsx` (43), +18 more |
| 4 | harness snapshot (agent left work uncommitted) | 2282 / 100 | `board-room.ts` (368), `board-store.ts` (298), `test-hooks.ts` (108), `board-seed.ts` (70), `room-state.ts` (59), `playwright.persistence.config.ts` (27), +13 more |
| 5 | 1 by the agent | 1570 / 140 | `SharePanel.tsx` (178), `HomePage.tsx` (95), `BoardPage.tsx` (81), `App.tsx` (74), `board-room.ts` (73), `board-store.ts` (59), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
