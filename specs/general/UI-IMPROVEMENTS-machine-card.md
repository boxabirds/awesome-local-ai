# UI/UX Improvements: the machine card on the overview

Review of one machine card (gruntus, running a Swift 1.5 llama.cpp run), 3 October 2026, from the owner's screenshot and
the live DOM of `http://127.0.0.1:7760/#/` (every link in each card listed). Separate file from the other reviews in this
folder.

## Summary

The card holds four different things at the same weight: a **machine** (gruntus, its queue), a **run** (the combination, its
id, its place in a series), a **story** (its number, title, minutes) and the **run's other stories** (the squares). They are
laid out as a running sentence ("▶ combination run · story 11 title · 2 min") followed by two strips and a footer, with no
labels, so a reader must work out which noun each mark belongs to. Links point at three different pages from the same line,
and several marks look linkable and are not (or are links and do not look it). It needs one hierarchy, read top to bottom,
with each level named once and linked once.

## Critical Issues

### Issue: Four entities in one line, with no hierarchy
**Current State**: `▶ 3.8-swift-1.5/27b llamacpp v2-fresh-r2 · story 11 Sketch freehand with a pen · 2 min`. Combination
(link), run id (bold link), story number (link), story title (plain text), minutes (bold, unlabelled).
**Problem**: Machine, run and story are siblings in one sentence, separated only by dots. "2 min" reads as the run's time or the
machine's time; it is the time on this story. The story title is plain text next to a link that says only "story 11". The state
is said twice (the blue "RUNNING" and the "▶").
**Recommendation**: Three labelled levels, each one line, in the entity order machine → run → story:
1. **Machine**: name (link to the machine page) and its state word, once. No "▶".
2. **Run**: the combination (link to the combination page) and the run id (link to the run page); under it the series (below).
3. **Story**: "Story 11, Sketch freehand with a pen" as one link to that story's run, then "2 min on this story" as plain text.
**Impact**: A reader can tell at once what is the machine, what it is running and what story it is on.
**Implementation Notes**: `MachineCards.tsx` and `NowSummary.tsx`; the machines list uses `NowSummary` too, so give the card its
own layout and leave the list's line as it is.

### Issue: The held-out strip is missing two squares, and has no numbers
**Current State**: Eleven stories are in scope; the card shows nine squares. The live DOM has all eleven, but the one being
built and the one not yet built have no border and no fill, so they are invisible.
**Problem**: The cause is in the stylesheet: the base rule for the squares and the dashed and outlined variants are nested under
`.run-page` in `run.css`, so they apply on the run page only. On the overview the filled squares only work because the card
re-draws them. A strip that stops at story 9 of 11 reads as "this run has 9 stories". There are no numbers, so a square cannot be
matched to "story 11" in the line above.
**Recommendation**: (1) Move the `.rs-sq` rules out of the run-page scope into `styles.css`, so every use of a square gets all its
states; remove the overview's workaround. (2) Label the strip: a small "Stories" caption, the story number under or inside each
square, the current one outlined in the accent colour and matching the Story line above it.
**Impact**: The strip shows all of the run, and ties to the story line.
**Implementation Notes**: a test that the card's building and not-built squares have a visible border fails first.

### Issue: Marks that look the same link to different things, or to nothing
**Current State**: Run links: the combination, the run id, "story 11" (a story run), the series segments (runs). Not links: the
squares (stories), the story title, "3 queued", "about 27 h of work", "run 2 of 5". The machine name links to the machine page.
**Problem**: A reader cannot tell what clicking does. A square is the natural thing to click and does nothing. The queue belongs
to the machine and gives no way to see it.
**Recommendation**: One linkage rule, shown by the layout: every noun is a link to its own page, once.
- Machine name → machine page (and "3 queued" → the machine page's queue).
- Combination → combination page; run id → run page; each series segment → that run's page.
- Each square, and the story line → the story run's page for that story.
- Plain text for what has no page of its own: minutes, "about 27 h".
**Impact**: Predictable clicks; the squares become the way into a story.
**Implementation Notes**: the squares need to be links (the run page's row already does it); keep a 14 px target with a larger hit area.

## High Priority Improvements

### Issue: The series is a second, unlabelled strip below the stories
**Current State**: Five squares ("59", a half-filled one, three dashed) and "run 2 of 5".
**Problem**: Two strips of squares (stories, then runs) look alike and sit one above the other with no caption. "run 2 of 5" repeats
what the highlighted segment already shows.
**Recommendation**: Put the series inside the run level, captioned: "Series v2-fresh on gruntus" then the five segments, with the
count in the caption ("run 2 of 5") and no separate text. Visually separate it from the stories strip with its caption and
spacing, and make the segments a different shape (wider rounded rectangles, as now) from the story squares.
**Impact**: Two strips, two clear meanings.

### Issue: The colours are unexplained on the card
**Recommendation**: A single caption line under the story strip on hover and a one-line key in the section's header: "squares: a
story's own held-out tests, green all pass, amber some, red few". The legend already exists on the run page.

## Medium Priority Enhancements

- **The queue** sits at the bottom as the machine's only link-less fact. Move it to the machine level (under the name) with the
  drain time as its caption: "3 queued · about 27 h of work".
- **Quiet states** (idle, waiting, unreachable) should keep the same three levels with the empty ones omitted, so a column of
  cards scans the same way.
- **Silent warning** (`⚠ no activity for N min`) belongs with the story level it is about, not after the minutes.

## Low Priority Suggestions

- Card height varies with the story title's length; clamp the title to two lines with the full text on hover.
- At narrow widths keep the three levels stacked in the same order.

## A suggested card

```
 gruntus                                                  RUNNING          <- machine (link); state once
 3 queued · about 27 h of work                                              <- the machine's queue (link)
 -------------------------------------------------------------------------
 RUN    3.8-swift-1.5/27b llamacpp · v2-fresh-r2         <- combination (link) · run (link)
        series v2-fresh, run 2 of 5   [59][▮▯][ ][ ][ ]   <- segments, each a link to its run
 -------------------------------------------------------------------------
 STORY  11. Sketch freehand with a pen · 2 min on this story               <- one link to the story run
        1 2 3 4 5 7 8 9 10 [11] 12     <- numbered squares, each a link to its story run
```

## Positive Observations

- The machine name already links to the machine page, and the state is in words as well as colour.
- The series segments already link to runs and carry their score; the story strip already uses the run page's colours.
- The card works from one view (`dashboardView`, `storyResults`), so the layout can change without touching the logic.
