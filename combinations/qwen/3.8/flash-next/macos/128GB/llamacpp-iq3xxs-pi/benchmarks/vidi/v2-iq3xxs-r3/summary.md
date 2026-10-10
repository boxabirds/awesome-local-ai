# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-iq3xxs-pi

Model `qwen3.8-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |

**New work** 22/23, **regressions** 0, **repairs** 0, **cumulative** 26/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 95.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 98%, server peak 69 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 94.7 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 99%, server peak 71 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 240.1 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 5 | — | throttled 90%, server peak 73 GB |

**Totals:** 3 stories, 430 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 26/27, stalled 0, partial 1, 9473 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [4, 7, 8] (implementation: [4]), held-out 6/7 (floor 0.571).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6774 / 73 | `BoardViewport.tsx` (241), `useCamera.ts` (218), `camera.ts` (184), `styles.css` (177), `playwright.config.ts` (148), `ZoomControls.tsx` (104), +18 more |
| 2 | 9 by the agent | 3210 / 67 | `StickyNote.tsx` (299), `board-model.ts` (281), `styles.css` (191), `StickyText.ts` (161), `StickyTextEditor.tsx` (144), `App.tsx` (133), +8 more |
| 3 | 4 by the agent, + harness snapshot | 5699 / 218 | `board-room.ts` (225), `NOTES.md` (175), `connectBoard.ts` (174), `playwright.browsers.ts` (133), `playwright.config.ts` (115), `App.tsx` (78), +20 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
