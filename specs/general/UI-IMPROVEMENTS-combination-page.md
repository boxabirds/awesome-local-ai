# UI/UX Improvements: the combination page, and the series it does not show

Review of the benchmarker's combination page, 4 October 2026, at
`#/vidi/c/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi`, about 1200 px wide. Evidence is the screenshot and the
live data behind it (`/api/state`), read the same day.

## Summary

A combination accumulates **series**: runs named `<prefix>-rN` that are one experiment. gufo has two, `v2` (5 finished)
and `v2-gufo05` (2 finished, 1 running, 2 queued). Every local combination has exactly two today, so this is the normal
shape of the data, not an edge case.

The page shows none of them. It presents one Score, one matrix and one time breakdown over every run at once. The
headline **66 (58–71) n=7** is a median across two different experiments, and the reader has no way to see that from
the page.

This is first a correctness problem and only then a layout one. The entity already exists in the code — `Series` in
`shared/dashboardView.ts`, drawn by `SeriesBar` and `SeriesRows` — and is used on the overview and the machine cards.
The combination page is the one place it is missing, and the one place it matters most.

## Critical Issues

### Issue: the headline score is a median across different experiments

**Current State.** `summarise()` ranks every finished run of the stack together. For the three local combinations:

| Combination | series | medians | shown |
|---|---|---|---|
| Swift 1.5 llama.cpp | `v2` (n=5), `v2-fresh` (n=3) | **61.0** and **66.0** | 61.5 |
| gufo | `v2` (n=5), `v2-gufo05` (n=2) | 66.0 and 67.5 | 66.0 |
| mlx-serve | `v2` (n=3), `v2-mlx26101` (n=1) | 69.0 and 70.0 | 69.5 |

**Problem.** Swift's two series differ by **5 held-out tests**, and the page reports a single 61.5 that describes
neither. A series is a deliberate change — a different engine build, quantisation or setting — so its runs are the
only ones comparable with each other. Pooling them answers a question nobody asked, and the reader cannot see the
pooling has happened. The same figure is what `rankCombinations` orders the overview by, so the ranking inherits it.

Note the methods rule already on the page: with 5 runs or fewer, a difference of 12 tests or less cannot separate two
combinations. That rule is about *runs of one thing*. Applying it to a pool of two experiments is a second error on
top of the first.

**Recommendation.** The score of record is per series. The combination's headline becomes its **current series** (the
one with work in hand, else the newest), with the others listed beside it. Where a combination has one series — the
common case for a reference model — the page reads exactly as it does now.

**Impact.** The headline answers "how good is this stack as it stands", not "what is the middle of everything we have
ever run here". Swift stops looking 5 tests worse than it is.

**Implementation Notes.** `seriesOf()` already groups and medians; `scoreOfRecord` already excludes partial reruns.

### Issue: a reader cannot see what experiments exist, or how far they have got

**Current State.** The run counts line says "7 finished (7 scored) · 1 running · 2 queued". The matrix lists runs
oldest first with no grouping. Nothing names `v2` or `v2-gufo05`, and nothing says what distinguishes them.

**Problem.** The owner's question on opening this page is "which run sets are there, what state is each in, what does
each score". Every one of those is absent, and the one clue — the run id prefix in the matrix's left column — requires
reading ten rows and inferring the grouping.

**Recommendation.** A **Series panel directly under the header**, one row each, newest first:

```
Series            Runs                     Score        Where the time went
v2-gufo05  ●●◐○○   2 of 5 · 1 running      67.5 (64–71) n=2    [prefill|gen|tools|…]
v2         ●●●●●   5 of 5 · finished       66.0 (58–68) n=5    [prefill|gen|tools|…]
```

using the existing `SeriesBar` for the dots. Each row links to the matrix filtered to that series.

**Impact.** The three questions are answered above the fold, in the order they are asked.

## High Priority Improvements

### The matrix is grouped by series, not flat

Give "Runs × stories" a header row per series, and a per-series median row. The current single "Median finished runs"
row spans two experiments and so compares each run against a mixture.

### "Where the time went, per run" is grouped and ordered by series

It currently lists `v2-gufo05-r3, r2, r1, v2-r1 … v2-r5` in one list, so the eye cannot compare like with like. The
same grouping as the matrix, with the series' own median bar, makes an engine-version change visible as a shift in the
bars — which is usually why the series exists.

### Say what a series *is*, where it is known

A series' identity is in its runs' `engine_settings` and model pins. Where every run of a series shares a value that
differs from the other series — a different `engine_version`, `quantisation`, `reasoning_effort` — the page can say so
in one line under the series name: "gufo 0.5.0 (23cacbb)" against "gufo b722a61". That is the difference the reader is
looking for, and it is already in the records.

## Medium Priority Enhancements

- **Predictability and the KPI strip** (hours, output tokens, calls per story) have the same pooling problem as the
  score. Compute them per series; show the current series' in the header.
- **"Why story runs differ"** counts flags over 80 story runs of both series together. Per series, or at least say
  which runs it covers.
- **The empty state**: a combination with one series should show no series panel at all, rather than a panel of one.

## Low Priority Suggestions

- The series panel is the natural place for a one-line note of what changed, if the owner ever wants to annotate a
  series by hand.
- `interventionCount` per series would show whether a particular build needed more rescuing.

## Positive Observations

- The matrix, the metric switch and the time bars are good and should not change in themselves — they need grouping,
  not redesign.
- `SeriesBar` already exists, is tested, and is the right component: the dots read at a glance and are used
  identically on the overview, so the page would gain a concept the reader has already met.
- The header's run counts line is the one place today that hints at work in hand; the series panel subsumes it.

## The data model question

Whether `Series` should be first class in storage, with its derived fields, or stay a presentation-level grouping.

**What exists.** `seriesOf(rows)` derives a series by stripping `-rN` from the run id and grouping by
`pack|stack|prefix`. Nothing is stored: no series id in a record, no field in the warehouse, nothing in dbench.

**For presentation-level (what we have).** Nothing to migrate or backfill. A run's id already carries its series, so
the grouping cannot disagree with the records. Renaming a series is renaming its runs, which the harness already
treats as the identity.

**For first class (stored).** The grouping rule is a regular expression over a human-chosen string. `v2-fresh-r1` and
`v2-r1` differ by a convention nobody enforces: a run called `v2-rerun` or `smoke-01` groups by accident, and a typo
splits a series silently. A stored series id would be checked when a run is submitted, and the derived fields (median
of record, n, state, the settings its runs share) would be computed once by dbench rather than in three places in the
app.

**Recommendation: keep the grouping derived, and make the rule enforced rather than guessed.** The run id is already
the identity in git, in dbench's queue and in every path; a second stored identity would be a thing to keep in step
with it. What is worth storing is not the series but its *consequence*: the **score of record per series**, computed
where the other scores are computed, so the app, the overview ranking and any analysis use the same number rather than
each deriving it. In practice:

1. `dbench submit` validates a run id against the `<prefix>-rN` shape and refuses one that would silently join or split
   a series.
2. `seriesOf` stays the single definition of the grouping, and the combination page uses it (it does not today).
3. The per-series score of record becomes a field the API serves, beside the existing per-run score, so the ranking and
   the page cannot drift apart.

If a series ever needs to carry something that is *not* derivable from its runs — a note on what changed, an owner's
decision to exclude one — that is the point at which it earns a record of its own, and not before.
