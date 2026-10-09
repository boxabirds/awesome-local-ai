## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

A checkpoint with a failing test was scored three times; each test counts its majority result, and Flaky is how many tests changed result between the scorings (timing-dependent app code).

| Story | New work | Regressions | Repairs | Cumulative | Flaky |
|---|---|---|---|---|---|
| 12 | 0/5 | 0 | 0 | 9/75 | 6 |

**New work** 0/5, **regressions** 0, **repairs** 0, **cumulative** 9/75.
