# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 48.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 47.9 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 40.2 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 123.2 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |

**Totals:** 4 stories, 260 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/4, final acceptance 29/31, stalled 0, partial 0, 10066 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6939 / 64 | `BoardViewport.tsx` (319), `useCamera.ts` (183), `camera.ts` (171), `styles.css` (154), `NOTES.md` (132), `ZoomControls.tsx` (97), +14 more |
| 2 | 1 by the agent | 2419 / 17 | `StickyNote.tsx` (255), `App.tsx` (202), `styles.css` (201), `board-model.ts` (165), `StickyText.ts` (124), `StickyTextEditor.tsx` (120), +6 more |
| 3 | 3 by the agent | 3844 / 113 | `board-room.ts` (142), `connectBoard.ts` (113), `protocol.ts` (60), `NOTES.md` (49), `index.ts` (43), `ConnectionStatus.tsx` (40), +13 more |
| 4 | 5 by the agent | 3536 / 153 | `board-room.ts` (468), `board-store.ts` (399), `NOTES.md` (125), `test-hooks.ts` (120), `room-state.ts` (100), `connectBoard.ts` (44), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
