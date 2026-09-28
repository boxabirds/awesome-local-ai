# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 34.2 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 53.8 | None | None | None | — | — | green | 23/27 |  | 0 / 5 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 3 stories, 122 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 23/27, stalled 0, partial 1, 5878 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 5/7 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6551 / 0 | `BoardViewport.tsx` (269), `useCamera.ts` (149), `styles.css` (145), `camera.ts` (126), `NOTES.md` (90), `playwright.config.ts` (67), +13 more |
| 2 | 1 by the agent | 2431 / 16 | `StickyNote.tsx` (295), `board-model.ts` (162), `App.tsx` (146), `styles.css` (136), `StickyTextEditor.tsx` (129), `StickyText.ts` (108), +8 more |
| 3 | harness snapshot (agent left work uncommitted) | 2951 / 161 | `NOTES.md` (179), `board-room.ts` (124), `connectBoard.ts` (96), `protocol.ts` (47), `ConnectionStatus.tsx` (39), `index.ts` (39), +15 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
