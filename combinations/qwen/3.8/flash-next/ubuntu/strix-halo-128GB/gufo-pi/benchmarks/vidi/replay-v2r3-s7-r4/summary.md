# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

**Partial rerun (diagnostic).** Story 7 only, built on `combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r3` at commit `57193bc` (its code when the story before ended). It measures that story on its own, with no earlier mistakes carried in; not comparable with full runs.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 7 | 8/8 | 0 | 0 | 41/44 |

**New work** 8/8, **regressions** 0, **repairs** 0, **cumulative** 41/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 7 | Select, move, resize and delete several objects at once | PARTIAL (red) | 71.5 | None | None | None | — | — | red | 41/44 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |

**Totals:** 1 stories, 71 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/1, final acceptance 41/44, stalled 0, partial 1, 13348 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 7 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [5, 10, 11, 12, 13, 14, 15] (implementation: [10, 11, 12, 13]), held-out 8/8 (floor 0.0).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 7 | 1 by the agent, + harness snapshot | 3234 / 392 | `useTransformGesture.ts` (319), `StickyNote.tsx` (221), `board-model.ts` (205), `geometry.ts` (184), `Marquee.tsx` (165), `App.tsx` (164), +11 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
