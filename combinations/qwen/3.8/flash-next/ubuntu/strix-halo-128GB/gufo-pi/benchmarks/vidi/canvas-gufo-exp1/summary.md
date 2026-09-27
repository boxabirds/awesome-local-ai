# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 16.7 | None | None | None | — | — | red | 0/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 58.9 | None | None | None | — | — | green | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 2 stories, 76 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/2, final acceptance 0/20, stalled 0, partial 0, 3651 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent, + harness snapshot | 5440 / 24 | `BoardViewport.tsx` (207), `useCamera.ts` (159), `camera.ts` (151), `package.json` (35), `playwright.config.ts` (35), `config.ts` (33), +10 more |
| 2 | 3 by the agent, + harness snapshot | 2921 / 72 | `StickyNote.tsx` (263), `board-model.ts` (245), `styles.css` (226), `StickyText.ts` (177), `App.tsx` (142), `StickyTextEditor.tsx` (108), +8 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
