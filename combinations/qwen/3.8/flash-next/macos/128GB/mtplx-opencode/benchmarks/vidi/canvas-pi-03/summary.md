# Vidi run — qwen/3.8/flash-next/macos/128GB/mtplx-opencode

Model `mtplx-flash-next-optimized-speed`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | 100 | 5844203 | 96786 | 0.9 | 63.7 | green | 6/6 |  | 0 / 0 | 1 | 115094 | throttled 96%, server peak 108 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 46.7 | 181 | 11185922 | 131257 | 1.0 | 57.0 | green | 19/20 |  | 0 / 0 | 1 | 115221 | throttled 99%, server peak 109 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 165.8 | 383 | 27388627 | 318864 | 1.2 | 67.7 | red | 25/27 |  | 0 / 5 | 6 | 115639 | throttled 56%, server peak 111 GB |

**Totals:** 3 stories, 247 agent-minutes, 664 requests, 44,418,752 prompt / 546,907 completion tokens, gate green 2/3, final acceptance 25/27, stalled 0, partial 1, 6487 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 6/7 (floor 0.0).

### Decode tok/s by context (server log, all stories)

| Context | Requests | Decode tok/s (request-weighted median of per-story medians) |
|---|---|---|
| 0-16k | 13 | 97.8 |
| 16-32k | 48 | 69.5 |
| 32-64k | 243 | 68.3 |
| 64-100k | 264 | 67.6 |
| 100-+k | 96 | 67.0 |

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6639 / 0 | `BoardViewport.tsx` (249), `useCamera.ts` (159), `camera.ts` (120), `ZoomControls.tsx` (77), `App.tsx` (45), `NavigationHint.tsx` (37), +11 more |
| 2 | 1 by the agent | 2340 / 23 | `StickyNote.tsx` (201), `App.tsx` (189), `board-model.ts` (183), `StickyTextEditor.tsx` (140), `StickyText.ts` (114), `NOTES.md` (110), +9 more |
| 3 | harness snapshot (agent left work uncommitted) | 4767 / 30 | `connectBoard.ts` (225), `board-room.ts` (169), `protocol.ts` (100), `index.ts` (73), `App.tsx` (68), `useBoardDoc.ts` (57), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.
