# UI/UX Improvements: the overview as an executive dashboard

Review of the benchmarker's overview page, `http://127.0.0.1:7760/#/`, 3 October 2026, at 1600 px, pack vidi, version
vidi-v2, "All runs". Asked to answer one question at a glance: **"What are my machines doing, and what needs
attention?"** Evidence: a screenshot of the live page and the live data behind it (`/api/state`), read the same day.
Separate file from the other reviews in this folder, which other sessions are still editing.

## Summary

The page is two tables. "Now" has four rows (machine, what is running, queue count). "Combinations" has six rows and
twelve numeric columns and fills two thirds of the page. Neither answers the question:

- **What are the machines doing?** Each line says "story 9 · 49 min" and "3 queued". It does not say how far through the
  run it is (story 9 of 11? run 2 of 5?), how long the story has been silent, how long the queue will take, or how busy
  the machine has been. Nothing is drawn: no bar, no line, no colour but one amber word ("idle").
- **What needs attention?** By design nothing is shown (see the constraint below). The few operational states that are
  facts about the work (idle with an empty queue, silent for 20 minutes) are 12 px grey text at the end of a row.
- **The bigger table is a research result, not a status.** It ranks combinations on score, with ten more columns of
  medians and ranges, all as text. Useful to read once; not what someone opens the page to see.

Recommended: a dashboard of four bands, top to bottom: **attention** (facts, if any), **machine cards**, **series
progress**, **the ranking as a chart**; the current tables stay underneath as the detail.

## The constraint that shapes "needs attention"

The repository's rules (`CLAUDE.md`, 1 Oct 2026) say the app presents benchmark results and **never shows its own or the
harness's faults, diagnoses, causes, remedies, commands or instructions, and has no "needs you" list**: a figure missing
because of an internal fault shows as not available with nothing about why; internal faults go to the monitor's log
(`ops/anomaly-tracking.md`). The overview's tests assert this. So the "attention" band below is limited to **facts about
the work**, each a state a person can see and decide on, with no cause and no instruction:

| Allowed (a fact about the work) | Not allowed (an internal fault or an instruction) |
|---|---|
| "gruntus: idle, nothing queued" | a re-score that failed or was skipped, an accounting check |
| "tritus: no activity for 25 min" (already shown as `⚠ no activity for N min`) | why it is silent, or what to run |
| "quintus: held, 9 queued" | harness or dbench errors, retries, restarts |
| "a series of 5 has finished: score median 66" | "needs you", "action required", commands |
| "macbook-air: not reachable" (as the app already shows it) | "run `dbench ...`" |

**Decision needed from the owner:** the question asks "what needs attention". If it means more than the allowed column
(for example "the monitor's open anomalies"), that changes a rule the owner set after the 1 Oct dashboard; this review
does not assume it does.

## Critical Issues

### Issue: The page does not show what a machine is doing, only what it is running
**Current State**: One line per machine: the run, the story title, minutes, queue count.
**Problem**: Progress, pace and queue length are the whole answer to "what are my machines doing", and none is shown. On
the live data: quintus has 9 queued jobs and its run is on story 12 after 159 minutes, but nothing says that is run 1 of
the 5 mlx-serve runs, or how long the queue is.
**Recommendation**: One **machine card** per machine in a row (4 across at 1600 px, stacked on a phone):
- Name, hardware (from the existing machine record), and a status word with colour (running, idle, held, unreachable).
- The running run as a **story strip**: 11 squares in scope, each filled by that story's held-out colour for those done,
  an outlined square for the one being built, dashed for pending (the strip already built for the run page).
- A **series bar**: "run 2 of 5" as five segments (done, running, queued) for the series this job belongs to.
- Time on this story, and a thin **pace line**: this story's minutes against the median of the same story on this stack.
- **Queue**: the count, and "about N h" derived from measured run durations of the queued stack (see the High items).
- A small **activity strip** for the last 24 hours (see below).
**Impact**: One glance answers the question for every machine. Nothing here is new data: the state already carries each
job's story, scope, minutes, queue place and finished runs.
**Implementation Notes**: a pure `shared/dashboardView.ts` (tested first) building one view per machine; SVG drawn
inline, no chart library (React 19, a few hundred lines). Reuse `storyResults` and `squareClass` from the run page.

### Issue: A visible bug on this page: unpressed chips are struck through
**Current State**: The header's "Complete runs" button is drawn with a line through its text, as is any unpressed chip
(`aria-pressed="false"`), app-wide.
**Problem**: Cause, read from the stylesheet: `src/pages/conversation.css` line 61, `.chip[aria-pressed="false"] {
text-decoration: line-through; opacity: .7 }`, is global, not scoped to the conversation page. It reads as "disabled" or
"removed" on a control that is just not selected, on every page.
**Recommendation**: Scope the rule to the conversation page (`.conversation-page .chip[aria-pressed="false"]`) or drop
the strike-through and keep only the opacity.
**Impact**: The run-filter switch and the metric switches read correctly again.
**Implementation Notes**: a one-line change in a file another session is editing; whoever owns that page should make it.

## High Priority Improvements

### Issue: No at-a-glance attention
**Recommendation**: An **attention band** at the very top, one line of chips, each a fact from the allowed column above,
each a link to the page that shows it: "gruntus idle · nothing queued", "tritus silent 25 min", "quintus 9 queued behind
a 12-hour run". When nothing qualifies, one quiet line: "Every machine is working." (the app already shows no quiet line
today: its tests forbid a ✓ line; this would need that test relaxed deliberately). Colour carries the state, text carries
the fact, and it is the only band that changes colour.
**Impact**: Answers the second half of the question in the first 80 px.

### Issue: Series progress is a text count in a table cell
**Current State**: "1 running / 4 queued / 2 cancelled" inside "Not counted".
**Recommendation**: A **series row per combination**: its five runs as segments left to right (finished = filled with the
run's score as a number inside; running = a partly filled segment with its story count; queued = outlined), the machine
named once, and a label "3 of 5 done". Cancelled runs are not drawn (they are not part of the series).
**Impact**: "How far along is each experiment" in one picture, in the order the owner thinks of them (n=5 per stack).

### Issue: The ranking is twelve columns of numbers
**Recommendation**: Replace the leading columns with a **range plot**: one row per combination, a dot for each run's score
of record, a bar for the median and the lowest-to-highest range, on one 0 to 75 axis, with the row label and n. Combinations
whose ranges overlap and have few runs are bracketed, which is the existing "too close to call" note, drawn instead of
written. Keep the full table, collapsed, under the plot ("Detail").
**Impact**: The comparison is visible without reading; the weak-evidence cases (n=2, n=3) are obvious.

### Issue: Nothing shows how busy the machines have been
**Recommendation**: A **utilisation timeline**: one lane per machine across the last 24 hours (or since the first run of
the series), each run a segment coloured by combination, gaps left empty so idle time is visible, a "now" line. Built from
each job's submitted and ended times (already in `Row.jobs`).
**Impact**: Shows idle gaps and imbalance across machines at a glance, the thing no table can.

## Medium Priority Enhancements

### Issue: The queue length is a count, not a duration
**Recommendation**: For each machine, "9 queued · about 70 h": the sum, over its queued jobs, of the median wall time of
the finished runs of that stack (measured, with n shown on hover: "median of 3 mlx-serve runs, 6h20m to 10h23m"). Where
a stack has no finished run, say "no estimate yet" and draw nothing. No guessed figure, per the project's rule.
**Impact**: Tells the owner when a machine will run dry before it does, which is when a new job is needed.

### Issue: References and benchmark machines are mixed
**Recommendation**: The reference rows (opus, sonnet) run on the Mac and are the yardstick, not a machine under test.
Show them as a dashed reference line on the range plot and keep "macbook-air" out of the machine cards unless it is
running something.

### Issue: The header carries too many controls above the first content
**Recommendation**: Pack, version, search, four tabs and the runs switch share one line at 1600 px and wrap below 1300.
On the dashboard the pack and version choices can sit in the ranking band's own heading (they only filter that band).

## Low Priority Suggestions

- Every chart gets a text equivalent: the machine card and series bar are lists with the same facts; the range plot's data
  is the existing table. Colours follow the app's pass-rate scale and never carry meaning alone.
- Below 1100 px the cards stack and the plot scrolls inside its panel (as the run page's table does).
- "updated 1 min ago" (already shown) could turn amber, as a fact, if the feed stops refreshing.

## A suggested layout (1600 px)

```
 ATTENTION   [gruntus: idle? no] [tritus: silent 25 min?]  or  every machine is working
 ------------------------------------------------------------------------------------------
 gruntus  ▶ running        macbook-air idle     quintus  ▶ running        tritus  ▶ running
 Swift 1.5 27B llama.cpp                        mlx-serve 26.10.1          gufo 0.5.0
 run 2 of 5  ■□□□□                               run 1 of 5  ■□□□□          run 1 of 5  ■□□□□
 stories ■■■■■■■▢▫▫▫▫  story 9, 49 min          ■■■■■■■■■■■▢ story 12      ■■■■■■■■▢▫▫▫ story 9
 3 queued · about 24 h                          9 queued · about 70 h      4 queued · about 33 h
 24 h ▁▇▇▇▇▇▇▇▇▇▇▇▇▇                             24 h ▇▇▇▇▇▇▇▇▇▇▇▇▇▇        24 h ▇▇▇▇▇▇▇▇▇▇▇▇▇▇
 ------------------------------------------------------------------------------------------
 SERIES                                         SCORE OF RECORD (0 to 75), median and range, one dot per run
 3.8 Swift 1.5  [59][61][..][..][..]  3 of 5     opus 5.5      ····|---●---|····
 3.8 flash gufo [66][..][▢ ][  ][  ]  ...        mlx-serve     ·  ·|--●--|   ·
 mlx-serve      [69][..][▢ ][  ][  ]             gufo 0.5      ·  · ·|---●---|·
 MTPLX          [  ][  ][  ][  ][  ]             Swift 1.5     · · ···|----●-----|
 ------------------------------------------------------------------------------------------
 Detail: Combinations (collapsed)     Now (the current table, as is)
```
(The figures here are only a sketch of the shapes, not data.)

## Positive Observations

- The "Now" table already separates what a machine is running from its queue, and marks a silent run and an unreachable
  machine in words, with no cause.
- The Combinations table's own rules are right and should survive in the Detail panel: ranked only on finished runs of
  record, the "too close to call" note, and no figure guessed.
- The new run filter, run order and fold sections apply cleanly to anything built here; machine cards must ignore the
  filter, as the "Now" table does today.
