# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-opencode

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 76.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 71%, server peak 84 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 59.0 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 79%, server peak 84 GB |
| 3 | See other people's edits appear live on the same board | DONE | 122.9 | None | None | None | — | — | green | 20/27 |  | 0 / 0 | 3 | — | DEGRADED (power) throttled 57%, server peak 84 GB |

**Totals:** 3 stories, 258 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 20/27, stalled 0, partial 0, 7759 lines in src+tests.

> Stories 3 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 8 by the agent | 7809 / 53 | `BoardViewport.tsx` (272), `useCamera.ts` (217), `camera.ts` (175), `styles.css` (155), `playwright.config.ts` (98), `README.md` (65), +15 more |
| 2 | 4 by the agent | 2846 / 24 | `StickyNote.tsx` (269), `board-model.ts` (210), `styles.css` (179), `StickyTextEditor.tsx` (149), `StickyText.ts` (124), `App.tsx` (117), +8 more |
| 3 | 4 by the agent | 3830 / 270 | `board-room.ts` (338), `connectBoard.ts` (105), `useBoardDoc.ts` (104), `styles.css` (78), `App.tsx` (69), `protocol.ts` (63), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
