# Truncated stories do not cascade

**Claim tested:** cutting a story short at the harness's time cap guarantees the next story fails, because it is
built on unfinished work.

**Status: refuted.** Capable stacks recover from a truncated story and usually score full marks on the next one.
What the data does show is narrower and more useful: **failure to recover discriminates between stacks**, and a
stack that cannot recover fails after completed stories too, so the cap is not its problem.

Checked 6 October 2026 against every recorded story run in the warehouse (`conversations.db`, 313 story runs).
**Corrected the same day** — see "A correction" at the end: the first version of this note keyed on `run` alone,
which is not unique, and reported a regression that does not exist.

## Evidence

Fourteen stories across all runs were ended by the operator at the 4-hour cap. Twelve of them have a following
story in the same run. Every one:

| run | stack | after cap of story | next story scored |
|---|---|---|---|
| v2-fresh-r5 | swift15 27B | 3 | **4/4** |
| v2-gufo05-r1 | gufo Flash-Next | 4 | **5/5** |
| v2-r1 | gufo Flash-Next | 10 | **6/5** — repaired an earlier failing test as well |
| v2-r4 | gufo Flash-Next | 4 | **5/5** |
| v2-mlx26101-r1 | mlx-serve Flash-Next | 11 | 4/5 |
| v2-mlx26101-r3 | mlx-serve Flash-Next | 11 | **5/5** |
| v2-mlx26101-r4 | mlx-serve Flash-Next | 4 | **6/5** — repaired an earlier failing test as well |
| v2-mlx26101-r4 | mlx-serve Flash-Next | 7 | **7/7** |
| v2-mlx26101-r5 | mlx-serve Flash-Next | 3 | **4/4** |
| v2-strata0139-r2 | Strata 3-bit | 3 | 1/4 |
| v2-strata0139-r2 | Strata 3-bit | 4 | 2/5 |
| v2-strata0139-r2 | Strata 3-bit | 7 | 1/7 |

**All nine on capable stacks recovered: 46 gained against 45 available.** Eight scored full marks or better, two
of them repairing a test that had been failing before the cap; one scored 4 of 5. Three of the twelve are one
weak stack.

## The decisive figure

Strata's three stories that followed a **completed** story scored **0 of 29**, against its 4 of 16 after a
capped one. It fails slightly *worse* after an intact predecessor than after a truncated one. Whatever is wrong
with that stack has nothing to do with truncation.

| | stories | gained / available |
|---|---|---|
| other stacks, after a completed story | 260 | 1525 / 1831 (83.3%) |
| other stacks, after a cap | 9 | **46 / 45** |
| Strata 3-bit, after a completed story | 3 | **0 / 29** |
| Strata 3-bit, after a cap | 3 | 4 / 16 (25.0%) |

## What cuts against it

**The sample is small.** Nine post-cap stories on capable stacks, across three stacks and four machines. One
catastrophic case would change the claim materially, and none exists in this data — but "none in nine" is a weak
guarantee. Re-check as runs accumulate.

**46 of 45 looks too good, and is not a finding.** Post-cap stories gained slightly more than became available,
while stories after a *completed* story gained 83.3%. A story that is cut off leaves work finished but unscored,
which the next story's held-out run then collects; that would explain it, and so would chance at n=9. It is a
hypothesis, not a result, and nothing should be decided on it.

**The 83.3% baseline is not a like-for-like comparison.** It pools 260 stories across every stack, including
weak ones and including the early stories of runs that later failed. It is here to show the post-cap figure is
not obviously worse, not to rank anything.

**`ended_by = 'operator'` records that the operator stopped the story, not why.** The 4-hour cap is the usual
reason and the one this note assumes throughout. The warehouse does not distinguish a cap from any other
operator stop, so a row here could be a stop for a different reason.

## What it changes

- **A run with capped stories need not be discarded or excluded from scoring.** Truncation does not invalidate
  what follows; the evaluation policy's design — the cumulative score is what a user would end up with — survives
  this test.
- **Recovery is a measurement worth having.** "Scored well on the story after a truncation" separates stacks more
  sharply than the stories themselves: 9 of 9 against 0 of 3.
- It removes the argument for automatically substituting a known-good baseline inside a full run. The evaluation
  policy already reserves that for diagnostic partial reruns, and this is evidence the restriction costs nothing.

## How to re-check

```sql
with o as (
  select run, stack, cast(story as integer) sn, ended_by, passed, total,
         lag(passed,1,0)  over w pp, lag(total,1,0) over w pt,
         lag(ended_by)    over w prev, lag(cast(story as integer)) over w psn
  from stories where status in ('DONE','PARTIAL')
  window w as (partition by stack, run order by cast(story as integer)))
select run, stack, psn capped_story, sn next_story, passed-pp gained, total-pt available
from o where prev = 'operator' order by stack, run, sn;
```

`partition by stack, run` — **not `run`**. Read the rows, not the sum.

## A correction

The first version of this note, committed and pushed on 6 October 2026, partitioned by `run` alone. A run *name*
is reused by every combination running that series: `v2-r4` names three runs, in three stacks, on three
machines. The window therefore computed one stack's story minus another stack's, and produced a row reading
`v2-r4 | swift15 27B | −24/5` — gufo's capped story 4 on the Strix Halo box (27 passed) subtracted from
llama.cpp's story 5 on the 4090 (3 passed). gufo's own next story scored 5 of 5.

Four things were wrong and one was right:

- The −24 did not exist, and the note called it "the largest single regression in the record".
- The post-cap figure of 15/45 (33.3%) was an artifact of that one invented row; it is 46/45.
- The 90.3% baseline was cross-contaminated the same way; it is 83.3%.
- `v2-r1` and `v2-r4` were attributed to swift15 27B; both are gufo on the Strix Halo box.
- The census was right: 14 capped stories, 12 with a follower, 313 story runs.

**The conclusion did not change — it strengthened.** "Refuted" stayed refuted, and eight-of-nine became
nine-of-nine.

What made it survive review: the outlier was *noticed*, written down as unexplained, and proposed as a follow-up
investigation, rather than treated as a reason to doubt the query. Rule 1 of the repository's own policy — a
surprising figure is a fault in the reading until proved otherwise — applies to a surprising *presence* exactly
as much as to a surprising absence. `tests/warehouse-sql-test.sh` now fails any committed query that keys on
`run` without `stack`.
