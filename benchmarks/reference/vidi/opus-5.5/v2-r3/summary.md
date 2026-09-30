# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope `canvas`, effort `client default`, client claude 2.1.284 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |

**New work** 20/23, **regressions** 0, **repairs** 0, **cumulative** 24/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 6.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 10.0 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 18.1 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 3 stories, 35 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 24/27, stalled 0, partial 0, 9142 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5825 / 0 | `BoardViewport.tsx` (214), `useCamera.ts` (137), `styles.css` (130), `camera.ts` (90), `playwright.config.ts` (44), `App.tsx` (43), +13 more |
| 2 | 1 by the agent | 2517 / 12 | `StickyNote.tsx` (221), `styles.css` (186), `board-model.ts` (182), `App.tsx` (134), `StickyText.ts` (127), `StickyTextEditor.tsx` (102), +9 more |
| 3 | 1 by the agent | 5280 / 38 | `board-room.ts` (123), `connectBoard.ts` (87), `protocol.ts` (86), `StickyText.ts` (71), `NOTES.md` (56), `StickyTextEditor.tsx` (53), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
