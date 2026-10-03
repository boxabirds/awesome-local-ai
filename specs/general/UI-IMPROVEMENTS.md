# UI/UX Improvements

Review of the benchmarker's conversation page, 3 October 2026, at
`#/vidi/r/<stack>/v2-gufo05-r1/s/1/conversation` (a story still running: 154 model calls, 170 tool calls, 651 events,
52 minutes), 1148 px wide. Reviewed as a reader who has just clicked a time bar to see what the agent did.

## Status (3 October 2026, later the same day)

The four Critical issues below are built and live: one list of turns with the overview as the only control surface
(kind chips, one search, the strip's click and drag), one row per turn with its tools under it and its engine request
in its figures, an SVG strip of calls, tool bands and compaction lines, and the Figures column folded into the Turn
column. Of the High items, m:ss times, one search and the call page opening folded are done; the labelled next and
previous turns are not. The Medium and Low items stand.

## Summary

The page has two things that should be one. A "Conversation" card at the top holds a summary line, a layout
switch ("In order" / "By type"), a row of counts by kind, and a timeline; below it, either one long list or seven
sections. The card is where the reader looks for an overview, but its parts do different jobs: the switch changes
what its siblings are, the counts are links in one mode and inert text in the other, and the timeline's ticks jump
into whichever sibling is shown. Nothing on the card says any of this. The list under it then shows every
happening as its own row, so one model call becomes four rows (the call, its engine request, a tool's start, the
tool's end) and the page runs to 40,000 pixels for a 52-minute story.

The owner's model is the right one: the card is an overview that lets the reader navigate one conversation. The
fix is to make the overview the only control surface (what kinds to show, what time range, what text) over one
list whose rows are the conversation's turns, and to drop the second layout.

## Critical Issues

### Issue: The overview controls its siblings instead of describing and navigating one thing
**Current State**: The "Conversation" card carries a two-way switch. "In order" shows one section, "By type"
shows seven; the switch is remembered. The row of counts under it ("Model calls 154 · Tool calls 170 …") links to
a section in "By type" and is plain text in "In order". The timeline's ticks scroll to a row in whichever layout
is shown and mark it. A bar part on the story-run page lands in "By type" at one section (`?at=tools`).
**Problem**: Three different kinds of control sit on one card with no visible relationship to what they change.
A reader cannot tell that the switch rebuilds the page below, nor why the same counts are sometimes links. Two
layouts of the same data double what there is to learn and test, and the `?at=` anchor only makes sense in one
of them.
**Recommendation**: One list, one overview, no layout switch.
- The counts become filter chips, each a toggle ("Model calls 154", "Tool calls 170", …): on by default, click to
  hide that kind, click again to show it; "only" on alt-click or a small "only" affordance; the list and the
  timeline reflect the selection. A bar part's link sets the chips (`?kind=tools` instead of `?at=tools`).
- The search box lives on the overview beside the chips, not in the list's heading; the list's heading shows
  "N of M shown" when anything narrows it.
- The timeline is the time navigator (next issue). Nothing on the card changes the page's structure.
**Impact**: One mental model: the card says what the conversation holds and lets the reader narrow it; the list
shows what the card selects. The "By type" sections and their anchors go away.
**Implementation Notes**: `ConversationPage.tsx`: remove `view`, the `Sec`-per-kind components and `SECTIONS`
as sections; keep `SECTIONS` as the chip definitions; `?at=` becomes `?kind=`; `SEGMENT_ANCHOR` maps a bar part
to a kind set. `conversationHref(…, at)` is renamed accordingly; `links.spec.ts` and `conversation.spec.ts` follow.

### Issue: One happening, several rows
**Current State**: Each model call is a row, its engine request is another row with the same time and the same
tokens restated, each tool call is two rows (its start with the argument, its end with the result), a compaction
is two rows. The example story has 651 rows for 154 calls; the first 40 rows alternate between 32 px and 107 px.
**Problem**: The reader has to re-assemble a turn from four lines, scanning for matching "call N" labels; the
request row says nothing the call row could not say in one more figure; the page is three times as long as the
conversation.
**Recommendation**: One row per turn of the conversation, nested:
- A model call row: time, "call N", what it said (folded at five lines), and its figures in one line including
  the engine's rate when the request was matched (`57 tok/s · drafts 88/104`).
- Under it, one line per tool it called: name and kind, the argument, the outcome and seconds, the result
  (folded). A tool still running shows "no end yet" in that line, not a separate row.
- Messages, compactions (one row with its duration and summary size), waits and readings stay as rows of their
  own, since they are turns of their own.
**Impact**: About 320 rows instead of 651 for this story, each a whole turn; nothing to re-assemble.
**Implementation Notes**: Build turns from the events on the client: group `tool_start`/`tool_end` by `refIdx`
and attach to the call by `callIdx`; attach `request` to its call by `callIdx`; a `compaction_end` joins its
start. The API and the warehouse do not change.

### Issue: The timeline draws idle time as blocks and hides the conversation's shape
**Current State**: 60 bins across the story; a bin with calls is a purple bar scaled to its count; a bin with no
calls is a grey block that, by a CSS fault, renders at the full 48 px although styled to 2% (18 of 60 bins here).
Compaction is a thin red top edge. Hovers say "N calls at T".
**Problem**: The eye reads the grey blocks as the data and the purple as gaps, the opposite of the truth. What
the reader wants from a timeline is where the agent was busy with the model, where it waited on tools, and where
it compacted, and a way to get to a moment.
**Recommendation**: A proper strip: a baseline; model calls as marks (height by thinking or tokens, one colour per
the bar's parts: prefill/decode purple), tool time as a lighter band under them, compactions as a vertical line,
waits as gaps. Click a point to jump to the nearest turn; drag to select a range, which narrows the list (and
the chips' counts say "n of N in range"). Keep the hover.
**Impact**: The timeline becomes the navigator the owner asked for; the list under it is always what the
timeline shows.
**Implementation Notes**: Replace `timeline()` bins with marks from the turns (call: tMs, sentMs→firstMs→tMs
spans; tool: start→end); an SVG strip, `shared/conversation.ts` computing the geometry so it is unit-tested;
selection state `rangeMs` in the page, applied before the kind and text filters. Fix `.tick.empty` on the way
(the span ignores the inline percentage height; a block with `height: 1px` does what was meant).

### Issue: The Figures column overlaps the Text column
**Current State**: On call rows the figures ("79 thinking · 3 text · 2 tools · read 2,149 · wrote 104 · toolUse")
run under the text of the next column (visible in the review's screenshot at 1148 px).
**Problem**: Two columns of text on top of each other; the figures are unreadable at that width.
**Recommendation**: With one row per turn the figures move into the call row's own line under its label, so the
collision goes; until then give `.figures` `white-space: normal` without the 1% rule, or move the figures under
the text.
**Impact**: Readable rows at every width.
**Implementation Notes**: `conversation.css`: `.conv-table td:not(.said)` sets `width: 1%; white-space: nowrap`,
which `.in-order .figures { white-space: normal; max-width: 28ch }` only half overrides; the cell is 1% wide and
its text overflows.

## High Priority Improvements

### Issue: Two searches, two counts
**Current State**: Each section (and the in-order list) has its own magnifier that opens its own search box in
its heading; the count shows "n of N" there while searching.
**Problem**: With one list the search is the overview's; a second one in the list's heading is a second place to
look.
**Recommendation**: One search box on the overview (beside the chips), always visible, placeholder "Search the
conversation"; the list heading shows "n of N" when the search or the chips narrow it. Keep the hit marking.

### Issue: Time is in seconds for an hour-long story
**Current State**: The "At" column shows "1,234.5 s".
**Problem**: Nobody reads 1,234 s as 20 minutes.
**Recommendation**: `m:ss` past a minute (`20:34`), seconds under it; the hover gives the clock time.

### Issue: The call page is a dead end from the list
**Current State**: "call N" opens the call page, which heads with "Call N of M" and a back link (added this
afternoon).
**Recommendation**: Keep it, and add the next and previous turns' first line as the links' labels so the reader
knows what they are stepping to. Also open the call page's thinking and text folded at five lines with the same
+ button, so a 48,000-character thinking block does not fill the screen on arrival.

## Medium Priority Enhancements

- **Kind badges and bar colours agree** (model purple, tools green, compaction red): keep this, and use the same
  colours for the timeline's marks and the chips' dots, so the three places read as one legend.
- **The fold button** (+) sits at the right edge of a wide cell, far from the text it unfolds; put it at the end
  of the fifth line, like "… more".
- **The sticky section heading** is now the one list's heading; pin the overview's chips and search with it, so
  narrowing is always at hand while scrolling 300 rows.
- **"so far"** on a running story is the only sign the list grows; a small "live" mark on the heading with the
  time of the last event would say it plainly.

## Low Priority Suggestions

- Drop the twisty on a page with one section; keep it only if a second section (readings, requests as tables)
  returns.
- The breadcrumb's last crumb reads "Conversation"; "Conversation of story 1" reads better when the story-run
  header is scrolled away.

## Positive Observations

- Pinned column heads and compact numeric columns work and should stay.
- Verbatim agent text is marked as such (`data-quoted="agent"`) and the search marks hits inside it; this is the
  right boundary between results and the app's own words.
- Folding cells at five lines keeps a 300-row list scannable.
- The page follows along without a reload and says "so far" while the story runs; the API behind it needs no
  change for any of the above.
