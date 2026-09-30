# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope `canvas`, effort `client default`, client claude 2.1.284 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 7/7 | 0 | 0 | 27/27 |
| 4 | 4/4 | 0 | 0 | 31/31 |

**New work** 27/27, **regressions** 0, **repairs** 0, **cumulative** 31/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 7.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 10.9 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 68.7 | None | None | None | — | — | green | 27/27 |  | 0 / 1 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 16.8 | None | None | None | — | — | green | 31/31 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 4 stories, 104 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 31/31, stalled 0, partial 0, 7804 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5602 / 0 | `BoardViewport.tsx` (190), `useCamera.ts` (142), `styles.css` (125), `camera.ts` (71), `package.json` (34), `playwright.config.ts` (34), +13 more |
| 2 | 1 by the agent | 2381 / 21 | `StickyNote.tsx` (250), `styles.css` (190), `board-model.ts` (170), `StickyText.ts` (132), `App.tsx` (103), `StickyTextEditor.tsx` (98), +9 more |
| 3 | 1 by the agent | 3169 / 86 | `board-room.ts` (115), `connectBoard.ts` (107), `NOTES.md` (55), `protocol.ts` (49), `StickyTextEditor.tsx` (38), `App.tsx` (33), +15 more |
| 4 | 1 by the agent | 2153 / 61 | `board-room.ts` (213), `board-store.ts` (199), `test-hooks.ts` (73), `NOTES.md` (59), `room-state.ts` (44), `App.tsx` (21), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
