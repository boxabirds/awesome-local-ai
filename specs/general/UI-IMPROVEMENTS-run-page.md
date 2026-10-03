# UI/UX Improvements: the run page's two story tables

Review of the benchmarker's run page, 3 October 2026, at `#/vidi/r/<stack>/v2-fresh-r2` (a Swift 1.5 run in progress:
stories 1 to 8 recorded, 9 being built, 10 to 12 not reached), about 2000 px wide. It is a separate file from
`UI-IMPROVEMENTS.md`, which is another review (the conversation page) that is still being edited. Evidence is the
screenshot and the live data behind it (`/api/state`), read the same day.

## Summary

The page lists the run's stories twice, one under the other: the panel "Held-out and where the time went" (11 rows) and
the per-story table inside "Cost" (7 rows). The two repeat the story, its link and its time, and show a third measure
under the same name, "Held-out", with different numbers for the same story and in different colours. A reader has to
read both and reconcile them. Run-level totals and the per-story figures also read as separate things when they are one
table and its total row.

## What is repeated

| Fact | Panel 1 (held-out and time) | "Cost" table | Third place |
|---|---|---|---|
| The story, its number, title and link to its story run | 11 rows, titles cut to fit | 7 rows, titles wrapped in full | "Compare with another run" lists the stories again |
| Time the story took | the bar and its total (27 min, 2h06m, 43 min, 35 min, 1h12m, 22 min) | "Agent time", the same values | |
| Held-out result | a colour square (the story's own tests after it) | a number `n/m` (see the next section) | |
| The run's totals | | the KPI strip above the table | |

The panel covers every story in scope, the table only recorded ones, so the two lists differ in length as well.

## Critical Issues

### Issue: One name, two measures, and they disagree
**Current State**: The square in panel 1 is the story's own held-out tests after that story (`ownPassed/ownTotal`).
The "Held-out" column of the Cost table is the story's flows against the latest build (`storiesWorking.squares`), though
its glossary entry says "This story's own held-out tests, passing after this story". From the live run:

| Story | Square (own tests) | Table column "Held-out" (latest build) |
|---|---|---|
| 2 | 8/10 | 7/10 |
| 3 | 5/7, drawn red | 5/7, drawn amber |
| 7 | 5/8, drawn red | 5/8, drawn amber |

**Problem**: Story 2 reads 8/10 on hover and 7/10 in the table, under the same word, on the same screen. Stories 3 and 7
show the same fraction as red in one panel and amber in the other, because the two use different colour rules. A reader
cannot tell which is right, and the definition on the table's heading describes the other one.
**Recommendation**: Show one measure in one place. Keep the story's own tests after it (what the glossary says and what
the score is built from). Put the latest-build figure, where it matters, on the story run's page, named for what it is
("against the final build"), not "Held-out".
**Impact**: Removes the one case where the page contradicts itself; the colour of a result means one thing everywhere.
**Implementation Notes**: `RunCost.tsx` `StoryCostTable` reads `run.storiesWorking.squares`; `RunTime.tsx` uses
`storyResults`. One colour function, `qualityClass`, for both.

### Issue: The same stories in two tables
**Current State**: Two panels, 11 and 7 rows, about 1,300 px of height for 7 stories.
**Problem**: Every story's identity, link and time is written twice, and the eye has to travel between two lists to read
one story's result, time and cost. Pending stories appear in one and not the other.
**Recommendation**: One panel, "Stories", one row per story in scope. Columns, left to right: the held-out square with its
`n/m`; the story title (the link to its story run); the time bar with its total; tool calls; output tokens; input tokens
with the cached share; generated tokens per second; draft acceptance. The run's totals sit above as one strip, and
become the table's total row.
- A story in progress or not reached keeps its row: bar and figures empty, a light italic grey "in progress" or
  "pending" (as built on the 3 Oct merge).
- Engine detail (generation and reading speed) goes in the tok/s hover, or behind one "engine detail" toggle, not two
  more permanent columns.
- The "all runs" link is the same on every row: put it on the title's hover or in one narrow last column.
**Impact**: One row answers "how did story 3 go and what did it cost". About half the vertical space. No second list to
reconcile.
**Implementation Notes**: merge `StoryCostTable`'s `COLS` into `RunTime`'s row; keep `data-story` on the row so the
existing links and tests find it; the "Cost" section id stays for the totals strip. Width: at 1500 px the title takes
390 px, the numbers about 70 px each, leaving the bar roughly 400 px; below 1100 px the numeric columns drop to a
second line under the bar, or the table scrolls sideways inside its panel.

## High Priority Improvements

### Issue: Titles are cut in one table and wrapped in the other
**Recommendation**: One rule for titles: one line, cut with an ellipsis, the full title on hover and in the story run's
page. Today panel 1 cuts "2. Capture ideas on sticky notes and rear…" while the table wraps the same title onto two lines.

### Issue: The bar and "Agent time" are two ways to say one number
**Recommendation**: In the merged row show the total once, at the end of the bar. The `Agent time` column goes.

## Medium Priority Enhancements

### Issue: Run totals are far from what they total
**Recommendation**: Make the totals the first row of the table (or its footer), in the same columns, so 903k output tokens
sits above the column of per-story output tokens and "over 7 stories" is visible as the column's own count.

### Issue: Stories 9 to 12 and the compare panel
**Recommendation**: The "Compare with another run" panel lists stories a third time. Once the table is one, its compare
control could become a second figure inside each row (a delta against the chosen run) instead of another list.

## Low Priority Suggestions

- The header of the merged panel could carry the one-scale note ("the longest story, 2h06m") and the segment legend on
  one line.
- Order is fixed by story number; an optional sort by time or by held-out result would help when hunting the slow story.

## Positive Observations

- The in-progress and pending words (3 Oct) tell the reader what an empty row means without a fault word.
- The time legend and segment colours are consistent and readable; numbers are right-aligned and tabular.
- Every story title is a link to its story run, and the square carries its result as a hover and a screen-reader label.
