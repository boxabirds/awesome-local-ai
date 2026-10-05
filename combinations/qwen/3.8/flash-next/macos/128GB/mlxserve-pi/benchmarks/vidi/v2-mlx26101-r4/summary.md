# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 6/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 1 | 34/36 |

**New work** 29/32, **regressions** 0, **repairs** 1, **cumulative** 34/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 70.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 91%, server peak 92 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 79.9 | None | None | None | — | — | green | 18/20 |  | 0 / 1 | 3 | — | throttled 92%, server peak 94 GB |
| 3 | See other people's edits appear live on the same board | DONE | 139.7 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 6 | — | throttled 80%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (amber) | 119.6 | None | None | None | — | — | green | 28/31 |  | 0 / 1 | 6 | — | throttled 95%, server peak 94 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 98.1 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 4 | — | throttled 81%, server peak 94 GB |

**Totals:** 5 stories, 507 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 34/36, stalled 0, partial 1, 19214 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **amber**: gate green, tasks not verified [4, 6, 7, 9] (implementation: [4, 7]), held-out 4/4 (floor 1.0).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 7050 / 49 | `cameraStore.ts` (279), `styles.css` (178), `BoardViewport.tsx` (175), `NOTES.md` (164), `playwright.config.ts` (157), `camera.ts` (157), +15 more |
| 2 | 4 by the agent | 4820 / 129 | `board-model.ts` (362), `StickyNote.tsx` (358), `styles.css` (240), `StickyTextEditor.tsx` (175), `StickyText.ts` (157), `App.tsx` (123), +11 more |
| 3 | 1 by the agent | 5948 / 146 | `board-room.ts` (221), `StickyTextEditor.tsx` (178), `connectBoard.ts` (175), `NOTES.md` (166), `useBoardDoc.ts` (88), `protocol.ts` (87), +15 more |
| 4 | 6 by the agent, + harness snapshot | 4408 / 228 | `board-store.ts` (918), `board-room.ts` (492), `room-state.ts` (152), `test-seed.ts` (90), `test-hooks.ts` (67), `connectBoard.ts` (59), +13 more |
| 5 | 1 by the agent | 3600 / 318 | `BoardPage.tsx` (326), `styles.css` (249), `App.tsx` (243), `SharePanel.tsx` (232), `board-store.ts` (209), `NOTES.md` (188), +13 more |

### Earlier stories broken or fixed

- **Story 5 broke 0, fixed 1** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `BoardPage.tsx` (326), `styles.css` (249), `App.tsx` (243), `SharePanel.tsx` (232), `board-store.ts` (209), `NOTES.md` (188), +13 more.
  - story 3: 6/7 → 7/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
