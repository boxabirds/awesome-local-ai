# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 75.1 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 36 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 111.7 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 37 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 240.0 | None | None | None | — | — | red | 22/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 38 GB |

**Totals:** 3 stories, 427 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 22/27, stalled 0, partial 1, 8103 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [3, 4, 6, 8, 9] (implementation: [3, 4]), held-out 5/7 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6325 / 24 | `BoardViewport.tsx` (224), `useCamera.ts` (189), `styles.css` (172), `camera.ts` (171), `NOTES.md` (149), `ZoomControls.tsx` (76), +16 more |
| 2 | 6 by the agent | 2842 / 54 | `StickyNote.tsx` (300), `board-model.ts` (236), `styles.css` (197), `StickyText.ts` (165), `StickyTextEditor.tsx` (118), `NOTES.md` (101), +8 more |
| 3 | 4 by the agent, + harness snapshot | 4448 / 335 | `board-room.ts` (436), `protocol.ts` (168), `connectBoard.ts` (111), `index.ts` (83), `styles.css` (39), `ConnectionStatus.tsx` (37), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
