## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

A checkpoint with a failing test was scored three times; each test counts its majority result, and Flaky is how many tests changed result between the scorings (timing-dependent app code).

| Story | New work | Regressions | Repairs | Cumulative | Flaky |
|---|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 | 0 |
| 2 | 10/10 | 0 | 0 | 20/20 | 0 |
| 3 | 7/7 | 0 | 0 | 27/27 | 0 |
| 4 | 4/4 | 0 | 0 | 31/31 | 0 |
| 5 | 5/5 | 0 | 0 | 36/36 | 0 |
| 7 | 8/8 | 0 | 0 | 44/44 | 0 |
| 8 | 7/7 | 0 | 0 | 51/51 | 0 |
| 9 | 6/6 | 0 | 0 | 57/57 | 0 |
| 10 | 8/8 | 0 | 0 | 65/65 | 0 |
| 11 | 5/5 | 0 | 0 | 70/70 | 0 |
| 12 | 5/5 | 0 | 0 | 75/75 | 0 |

**New work** 71/71, **regressions** 0, **repairs** 0, **cumulative** 75/75.
