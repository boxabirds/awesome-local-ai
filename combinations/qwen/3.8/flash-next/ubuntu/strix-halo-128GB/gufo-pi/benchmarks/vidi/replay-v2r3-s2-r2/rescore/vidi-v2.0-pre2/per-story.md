## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

A checkpoint with a failing test was scored three times; each test counts its majority result, and Flaky is how many tests changed result between the scorings (timing-dependent app code).

| Story | New work | Regressions | Repairs | Cumulative | Flaky |
|---|---|---|---|---|---|
| 2 | 8/10 | 0 | 0 | 17/20 | 0 |

**New work** 8/10, **regressions** 0, **repairs** 0, **cumulative** 17/20.
