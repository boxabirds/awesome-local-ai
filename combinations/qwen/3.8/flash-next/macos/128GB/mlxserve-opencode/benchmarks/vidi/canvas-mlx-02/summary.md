# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-opencode

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 28.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 73%, server peak 80 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 48.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 98%, server peak 83 GB |

**Totals:** 2 stories, 77 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 20/20, stalled 0, partial 0, 4188 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6877 / 0 | `BoardViewport.tsx` (288), `useCamera.ts` (144), `camera.ts` (106), `ZoomControls.tsx` (101), `NOTES.md` (82), `package.json` (35), +14 more |
| 2 | 1 by the agent | 2602 / 12 | `StickyNote.tsx` (306), `board-model.ts` (193), `StickyTextEditor.tsx` (130), `App.tsx` (120), `StickyText.ts` (91), `NoteToolbar.tsx` (86), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
