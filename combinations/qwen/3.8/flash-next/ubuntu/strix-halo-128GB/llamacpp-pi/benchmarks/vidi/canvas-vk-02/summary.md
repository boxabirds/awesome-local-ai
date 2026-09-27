# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 75.1 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 36 GB |

**Totals:** 1 stories, 75 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 5/6, stalled 0, partial 0, 2300 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6325 / 24 | `BoardViewport.tsx` (224), `useCamera.ts` (189), `styles.css` (172), `camera.ts` (171), `NOTES.md` (149), `ZoomControls.tsx` (76), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
