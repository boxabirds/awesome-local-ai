# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 38.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 20 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 40.1 | None | None | None | — | — | green | 18/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 23 GB |

**Totals:** 2 stories, 79 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 18/20, stalled 0, partial 0, 4179 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6601 / 42 | `BoardViewport.tsx` (194), `useCamera.ts` (175), `camera.ts` (162), `styles.css` (106), `NOTES.md` (72), `App.tsx` (53), +14 more |
| 2 | 1 by the agent | 2576 / 14 | `StickyNote.tsx` (238), `styles.css` (170), `board-model.ts` (167), `StickyTextEditor.tsx` (139), `App.tsx` (130), `StickyText.ts` (82), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
