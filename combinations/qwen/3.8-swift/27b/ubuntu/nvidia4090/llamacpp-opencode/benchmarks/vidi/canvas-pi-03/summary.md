# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 10.4 | None | None | None | — | — | green | 0/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 33.5 | None | None | None | — | — | red | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 19 GB |

**Totals:** 2 stories, 44 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/2, final acceptance 0/20, stalled 0, partial 0, 3769 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7615 / 0 | `BoardViewport.tsx` (219), `useCamera.ts` (121), `camera.ts` (115), `ZoomControls.tsx` (97), `App.tsx` (43), `playwright.config.ts` (33), +13 more |
| 2 | 1 by the agent | 2335 / 7 | `StickyNote.tsx` (272), `board-model.ts` (189), `StickyTextEditor.tsx` (174), `App.tsx` (148), `NoteToolbar.tsx` (102), `StickyText.ts` (96), +6 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
