# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

**Partial rerun (diagnostic).** Story 9 only, built on `combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r3` at commit `5c2da1c` (its code when the story before ended). It measures that story on its own, with no earlier mistakes carried in; not comparable with full runs.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 9 | 5/6 | 0 | 0 | 50/57 |

**New work** 5/6, **regressions** 0, **repairs** 0, **cumulative** 50/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | Write free text anywhere on the board | DONE | 70.7 | None | None | None | — | — | green | 50/57 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |

**Totals:** 1 stories, 71 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 50/57, stalled 0, partial 0, 17605 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 9 | 1 by the agent | 3395 / 403 | `TextEditor.tsx` (254), `StickyTextEditor.tsx` (251), `text.ts` (227), `textLayout.ts` (220), `TextObject.tsx` (157), `App.tsx` (124), +21 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
