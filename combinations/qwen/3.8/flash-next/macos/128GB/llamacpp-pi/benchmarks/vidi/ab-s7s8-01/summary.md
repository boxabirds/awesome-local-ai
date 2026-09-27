# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | 100 | 5844203 | 96786 | 0.9 | 63.7 | green | 6/6 |  | 0 / 0 | 1 | 115094 | throttled 96%, server peak 108 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 46.7 | 181 | 11185922 | 131257 | 1.0 | 57.0 | green | 19/20 |  | 0 / 0 | 1 | 115221 | throttled 99%, server peak 109 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 165.8 | 383 | 27388627 | 318864 | 1.2 | 67.7 | red | 25/27 |  | 0 / 5 | 6 | 115639 | throttled 56%, server peak 111 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 55.8 | 172 | 11675670 | 147343 | 2.0 | 67.0 | green | 29/31 |  | 3 / 0 (ended in error) | 5 | 115993 | throttled 85%, server peak 100 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 100.9 | 372 | 25806362 | 204304 | 1.3 | 72.2 | green | 34/36 |  | 1 / 0 | 5 | 115757 | throttled 60%, server peak 105 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3 | 168.1 | None | None | None | — | — | green | 42/44 |  | 0 / 0 | 4 | — | throttled 95%, server peak 88 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 3 | 134.6 | None | None | None | — | — | green | 49/51 |  | 0 / 0 | 3 | — | throttled 94%, server peak 88 GB |

**Totals:** 7 stories, 706 agent-minutes, 1208 requests, 81,900,784 prompt / 898,554 completion tokens, gate green 6/7, final acceptance 49/51, stalled 0, partial 1, 16646 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 6/7 (floor 0.0).
- Story 4, built on partial 3: held-out tests on the partial base 10/11; partial story's tests fixed 0, regressed 0; 3 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 15/16; partial story's tests fixed 0, regressed 0; 6 stub-like lines added to src/.
- Story 7, built on partial 3: held-out tests on the partial base 23/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 3: held-out tests on the partial base 30/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 22 | 93.1 |
| 16-32k | 92 | 73.8 |
| 32-64k | 429 | 68.3 |
| 64-100k | 468 | 67.6 |
| 100-+k | 197 | 67.0 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | — | 0 / 0 | — |
| 4 | — | 0 / 0 | — |
| 5 | — | 0 / 0 | — |
| 7 | 1 by the agent | 4342 / 268 | `useTransformGesture.ts` (349), `board-model.ts` (304), `geometry.ts` (202), `useSelection.ts` (190), `App.tsx` (182), `registry.tsx` (173), +8 more |
| 8 | 2 by the agent | 1512 / 16 | `undo.ts` (141), `App.tsx` (77), `NOTES.md` (76), `useUndo.ts` (54), `UndoButtons.tsx` (38), `StickyTextEditor.tsx` (34), +6 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
