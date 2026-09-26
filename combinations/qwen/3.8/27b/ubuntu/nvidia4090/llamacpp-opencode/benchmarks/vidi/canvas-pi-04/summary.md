# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 40.0 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 17 GB |

**Totals:** 1 stories, 40 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 6/6, stalled 0, partial 0, 1867 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 5 by the agent | 6788 / 49 | `useCamera.ts` (249), `BoardViewport.tsx` (224), `camera.ts` (214), `styles.css` (129), `NOTES.md` (95), `ZoomControls.tsx` (47), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.
