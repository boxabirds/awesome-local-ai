# Vidi run — reference/sonnet-5.5

Model `claude-sonnet-5-5`, scope `canvas`, effort `client default`, client claude 2.1.285 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |

**New work** 16/16, **regressions** 0, **repairs** 0, **cumulative** 20/20.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 6.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 7.2 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 0 | — | throttled 0% |

**Totals:** 2 stories, 13 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/2, final acceptance 20/20, stalled 0, partial 0, 2574 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5046 / 0 | `BoardViewport.tsx` (210), `useCamera.ts` (100), `camera.ts` (67), `ZoomControls.tsx` (43), `package.json` (32), `App.tsx` (30), +12 more |
| 2 | 1 by the agent | 1620 / 11 | `StickyNote.tsx` (216), `board-model.ts` (134), `StickyTextEditor.tsx` (109), `App.tsx` (82), `StickyText.ts` (65), `NoteToolbar.tsx` (62), +7 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**3 restart (no intervention logged); 205 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 2 | 01 Oct 03:15 | 3 min | restart (no intervention logged) | — |
| 2 | 01 Oct 03:17 | 2 min | restart (no intervention logged) | — |
| 2 | 01 Oct 03:22 | 200 min | restart (no intervention logged) | — |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 2 | 9 min | 205 min | 7 min |
