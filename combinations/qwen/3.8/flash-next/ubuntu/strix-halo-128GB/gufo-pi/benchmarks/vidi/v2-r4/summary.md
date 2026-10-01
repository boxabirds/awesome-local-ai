# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 4/7 | 0 | 0 | 23/27 |
| 4 | 4/4 | 0 | 0 | 27/31 |
| 5 | 5/5 | 0 | 0 | 32/36 |

**New work** 28/32, **regressions** 0, **repairs** 0, **cumulative** 32/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 51.7 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 39.2 | None | None | None | — | — | green | 23/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (amber) | 92.2 | None | None | None | — | — | green | 27/31 |  | 0 / 5 | 2 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 32.2 | None | None | None | — | — | green | 32/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 5 stories, 250 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/5, final acceptance 32/36, stalled 0, partial 1, 11242 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 4/4 (floor 0.25).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 6 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 7219 / 83 | `BoardViewport.tsx` (278), `useCamera.ts` (227), `camera.ts` (189), `styles.css` (183), `NOTES.md` (84), `ZoomControls.tsx` (75), +15 more |
| 2 | 2 by the agent | 3111 / 34 | `StickyNote.tsx` (288), `board-model.ts` (234), `styles.css` (184), `StickyTextEditor.tsx` (142), `StickyText.ts` (138), `App.tsx` (126), +8 more |
| 3 | 1 by the agent | 3290 / 21 | `board-room.ts` (148), `connectBoard.ts` (99), `protocol.ts` (58), `App.tsx` (47), `ConnectionStatus.tsx` (40), `styles.css` (31), +11 more |
| 4 | harness snapshot (agent left work uncommitted) | 2361 / 108 | `board-room.ts` (383), `board-store.ts` (250), `room-state.ts` (66), `index.ts` (39), `config.ts` (23), `connectBoard.ts` (22), +12 more |
| 5 | 1 by the agent | 1857 / 239 | `tasks.md` (202), `styles.css` (188), `SharePanel.tsx` (145), `board-room.ts` (129), `BoardPage.tsx` (82), `index.ts` (74), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
