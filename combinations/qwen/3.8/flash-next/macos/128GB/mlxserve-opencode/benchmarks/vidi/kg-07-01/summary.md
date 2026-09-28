# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-opencode

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.86.0, host Apple M5 Max 128GB.

**Known-good mode (diagnostic).** Story 7 only, built on `benchmarks/reference/vidi/opus-5.5/run-3` at commit `c6eb91f` (its code when the story before ended). It measures that story on its own, with no earlier mistakes carried in; not comparable with full runs. The reference was built from an older spec, so the base's spec was brought up to this pack's version.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 7 | 6/8 | 0 | 0 | 42/44 |

**New work** 6/8, **regressions** 0, **repairs** 0, **cumulative** 42/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 7 | Select, move, resize and delete several objects at once | PARTIAL (amber) | 84.4 | None | None | None | — | — | green | 42/44 |  | 0 / 5 | 3 | — | throttled 97%, server peak 93 GB |

**Totals:** 1 stories, 84 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/1, final acceptance 42/44, stalled 0, partial 1, 13085 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 7 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **amber**: gate green, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [2, 8, 10, 11, 12, 13]), held-out 6/8 (floor 0.25).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 7 | harness snapshot (agent left work uncommitted) | 3675 / 200 | `useTransformGesture.ts` (341), `App.tsx` (246), `board-model.ts` (176), `StickyNote.tsx` (172), `SelectionOverlay.tsx` (153), `geometry.ts` (152), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
