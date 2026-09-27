# Vidi run — qwen/3.8/flash-next/macos/128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 55.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 88%, server peak 81 GB |

**Totals:** 1 stories, 56 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 6/6, stalled 0, partial 0, 2460 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6362 / 1 | `BoardViewport.tsx` (291), `useCamera.ts` (218), `styles.css` (182), `camera.ts` (137), `NOTES.md` (101), `playwright.config.ts` (95), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
