# Truncated stories do not cascade

**Claim tested:** cutting a story short at the harness's time cap guarantees the next story fails, because it is
built on unfinished work.

**Status: refuted.** Capable stacks recover from a truncated story and usually score full marks on the next one.
What the data does show is narrower and more useful: **failure to recover discriminates between stacks**, and a
stack that cannot recover fails after completed stories too, so the cap is not its problem.

Checked 6 October 2026 against every recorded story run in the warehouse (`conversations.db`, 313 story runs).

## Evidence

Fourteen stories across all runs were ended by the operator at the 4-hour cap. Twelve of them have a following
story in the same run. Every one:

| run | stack | after cap of story | next story scored |
|---|---|---|---|
| v2-fresh-r5 | swift15 27B | 3 | **4/4** |
| v2-gufo05-r1 | gufo Flash-Next | 4 | **5/5** |
| v2-mlx26101-r1 | mlx-serve Flash-Next | 11 | 4/5 |
| v2-mlx26101-r3 | mlx-serve Flash-Next | 11 | **5/5** |
| v2-mlx26101-r4 | mlx-serve Flash-Next | 4 | **6/5** — repaired an earlier failing test as well |
| v2-mlx26101-r4 | mlx-serve Flash-Next | 7 | **7/7** |
| v2-mlx26101-r5 | mlx-serve Flash-Next | 3 | **4/4** |
| v2-r1 | swift15 27B | 10 | 4/5 |
| v2-r4 | swift15 27B | 4 | **−24/5** |
| v2-strata0139-r2 | Strata 3-bit | 3 | 1/4 |
| v2-strata0139-r2 | Strata 3-bit | 4 | 2/5 |
| v2-strata0139-r2 | Strata 3-bit | 7 | 1/7 |

**Eight of the nine on capable stacks scored at or near full marks.** One regressed catastrophically. Three of
twelve are one weak stack.

## The decisive figure

Strata's three stories that followed a **completed** story scored **0 of 29**, against its 4 of 16 after a
capped one. It fails slightly *worse* after an intact predecessor than after a truncated one. Whatever is wrong
with that stack has nothing to do with truncation.

| | stories | gained / available |
|---|---|---|
| other stacks, after a completed story | 269 | 1136 / 1258 (90.3%) |
| other stacks, after a cap | 9 | 15 / 45 (33.3%) |
| Strata 3-bit, after a completed story | 3 | **0 / 29** |
| Strata 3-bit, after a cap | 3 | 4 / 16 |

## What cuts against it

**The 33.3% above is misleading, and so is any single percentage here.** One run, `v2-r4`, lost 24 held-out tests
in the story after a cap. Summed, that one story swamps the other eight and turns 39-of-40 into 15-of-45. The
median story after a cap recovers completely; the mean says the opposite. Quote the distribution, not the
average.

Equally, **39 of 40 is a cherry-pick** — it is the figure you get by removing the one case that disagrees. The
honest statement is *eight of nine recovered, one did not*, with the one named.

**The sample is small.** Nine post-cap stories on capable stacks. A tenth catastrophic case would halve the
claim. This should be re-checked as runs accumulate.

`v2-r4`'s −24 is unexplained and is not obviously caused by the cap. It is the largest single regression in the
record and nobody has looked at it.

## What it changes

- **A run with capped stories need not be discarded or excluded from scoring.** Truncation does not invalidate
  what follows; the evaluation policy's design — the cumulative score is what a user would end up with — survives
  this test.
- **Recovery is a measurement worth having.** "Scored well on the story after a truncation" separates stacks more
  sharply than the stories themselves: 8 of 9 against 0 of 3.
- It removes the argument for automatically substituting a known-good baseline inside a full run. The evaluation
  policy already reserves that for diagnostic partial reruns, and this is evidence the restriction costs nothing.

## How to re-check

```sql
with o as (
  select run, stack, cast(story as integer) sn, ended_by,
         passed - lag(passed,1,0) over (partition by run order by cast(story as integer)) gained,
         total  - lag(total,1,0)  over (partition by run order by cast(story as integer)) available
  from stories where status in ('DONE','PARTIAL')),
n as (select o.*, lag(ended_by) over (partition by run order by sn) prev from o)
select run, stack, sn, gained, available from n where prev = 'operator' order by run, sn;
```

Read the rows, not the sum.
