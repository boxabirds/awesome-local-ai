# UI/UX Improvements

Three reviews of the benchmarker, newest first. Part 1 is the story-run header as it sits above the
conversation (3 October 2026, evening). Part 2 is navigation across the site (3 October 2026, evening; built).
Part 3 is the conversation page (3 October 2026, afternoon; its Critical and most High items are built).

## Part 1: the story-run header above the conversation (3 October 2026)

### Status (3 October 2026, the same evening)

Built: the conversation and call pages carry one line (story number and title; status, held-out fraction, agent
time; the run's state and machine only while running, failed, stopped or cancelled) in the conversation's pinned
head, and no card. The story-run page's card has no eyebrow, says "run on machine" with the run's state only when
it matters, puts the two fractions under one Held-out heading as "This story" and "Suite so far" with the
explanations as hovers, and shows agent time at the other figures' size. A story without a title is its number
alone. Not done: the breadcrumb does not carry the title on hover.

Reviewed from the owner's screenshot of `…/v2-gufo05-r1/s/1/conversation`, a story still running, and the code
that draws it (`StoryRunParts.tsx` `StoryRunHeader`, `run.css`, `ConversationPage.tsx`). The owner's words: "cluttered
with lots of useless unnecessary information and could take up far less space. Focus on what is essential and
emphasise that; delete informational clutter and deemphasise the rest."

### Summary

The conversation page opens with the story-run page's header card, whole, and then its own pinned head
(title, count, range, chips, search, strip). The card was designed for a page about the story run, where its four
figures are the point. Above a conversation they are context, and most of the card is not even that: a label
saying what kind of thing the card is, the combination and run and story the breadcrumb has just named, two
statuses, two held-out fractions with a sentence under each explaining the difference, and a 32 px "52 min".
Twelve pieces of text, four of them explanations, for a reader who came to read what the agent did.

What is essential here: which story (number and title), whether it is done and how it did (one status, one
fraction), and that it is still running if it is. Everything else is a click away on the story-run crumb.
The fix is one line, not a card, and it belongs on the conversation's own pinned head so the page starts
with the conversation.

### Critical Issues

#### Issue: A page about the conversation starts with a card about something else
**Current State**: `ConversationPage` renders `<StoryRunHeader>` unchanged under the breadcrumb, then its own
`conv-head`. The card: eyebrow STORY RUN; h1 "Story 1 · Pan and zoom around an infinite board"; a line "3.8/
flash-next gufo **v2-gufo05-r1** on tritus · run ▶ running"; then four stats with uppercase labels: STORY
STATUS "DONE", HELD-OUT "6/6" with "this story's own tests, after it", WHOLE SUITE SO FAR "6/6" with "whole
suite so far", AGENT TIME "52 min" in the page's largest type.
**Problem**: The reader has to scroll past the card and the conversation's own head before the first turn.
The card's loudest element (52 min) is the least relevant figure on this page; the breadcrumb directly above
already says combination › run › story; "run ▶ running" and "STORY STATUS DONE" are two statuses of two
things, side by side, which reads as a contradiction until the reader works out that one is the run's and one
the story's; "whole suite so far" duplicates "held-out" on every story where they agree; the two subtitles
explain a distinction that belongs in the glossary hover, not on every page load. The eyebrow "STORY RUN"
names the card's type for nobody.
**Recommendation**: Delete the card from the conversation page. Put one line at the top of the conversation's
pinned head, before the "Conversation" row:

    Story 1 · Pan and zoom around an infinite board      done · 6/6 · 52 min · running on tritus

Left: the story's number and title, the page's h1 (18 px, not 22). Right, in the small muted type the head
already uses for "count · range · events": the story's status word in its colour, the held-out fraction, the
agent time, and only while the run is still going, "running on <machine>" with the ▶ mark. Nothing else: no
eyebrow, no labels, no subtitles, no whole-suite fraction (it is on the story-run page, one crumb back), no
combination or run name (the breadcrumb has both, and the title of the window too).
**Impact**: The first turn is on screen when the page opens. The reader's eye lands on the story's title and
then the conversation, not on a 52.
**Implementation Notes**: a `StoryRunLine` in `StoryRunParts.tsx` (or in `ConversationPage.tsx`, it is used
nowhere else) taking `run`, `st`, `storyId`, `title`; `ConversationPage` and `CallPage` use it in place of
`StoryRunHeader`. The glossary hovers stay on the words ("done" carries `storyStatus`, "6/6" carries
`storyHeldOut`). Tests: `conversation.spec.ts` section A asserts the line's text for a recorded story and for
one still being built (status "building", no fraction); `no-faults.spec.ts` sweeps it as part of the page.

### High Priority Improvements

#### Issue: The same card on the story-run page carries the same clutter
**Current State**: On `…/s/1` the card is the page's header and its figures are the page's point, but the
eyebrow, the two subtitles and the two-status line are the same there.
**Recommendation**: Keep the card there with: no eyebrow; the of-run line as "v2-gufo05-r1 on tritus · ▶
running" (the combination is in the breadcrumb and the h1 can carry it on hover); the subtitles removed from
under the fractions and kept as the terms' hovers; the two fractions labelled "This story" and "Suite so far"
under one heading "Held-out"; agent time at the same size as the other figures. The story's status word stays
first and keeps its colour.
**Impact**: The page about the story run stays a page of figures, a third shorter, with one status per
thing and nothing explaining itself twice.

#### Issue: Two statuses, one next to the other, for two different things
**Current State**: "run ▶ running" (the run's) on the of-run line, "STORY STATUS DONE" (the story's) in the
stats.
**Recommendation**: The story's status is the one that matters on a story page; show it first and in colour.
The run's status is shown only when it differs in a way the reader needs: running (so the conversation may
grow), failed or cancelled (so the story may have been cut short). "finished" adds nothing and goes.

### Medium Priority Enhancements

- **The call page** has the same card above one call. The same one line, with "call 3 of 20" where the
  conversation page has its count.
- **"title not known yet"** in the h1 for a story without a title reads as a fault note; show the number alone.
- **The breadcrumb and the h1 both say "Story 1"**; once the line is one row this is fine, but the crumb could
  carry the title on hover for a reader scanning the trail.

### Low Priority Suggestions

- Agent time as "52 min" is right; the 32 px `big-n` style is for the one number a page is about (the run
  page's score), and should not be reused for a context figure anywhere.

### Positive Observations

- The breadcrumb now carries the whole identity (combination › run › story), which is what makes the card's
  identity lines deletable.
- The glossary hovers on the labels are the right place for "this story's own tests, after it"; the words
  only need to move there.

## Part 2: navigation across the site (3 October 2026)

### Status (3 October 2026, the same evening)

Built: the four section addresses (`#/`, `#/<pack>/stories`, `#/machines`, `#/setup`; machine pages under
`#/machines/<name>` with `#/m/<name>` kept), tabs as links selected by the page's section, the remembered tab
gone, one `trailFor` building every breadcrumb (sentence case, Stories and Machines levels), the window's title
from the trail, scroll restored on Back and Forward with a link starting at the top, the conversation page's
kinds, search and span in its address, the call page's way back landing on its row, Remove machine leaving for
the machines list, and a stories index page. Not done: the search box's Enter still assigns the hash (its rows
are links already); the not-found page still says "Back to the overview".


Reviewed at 1148 px wide against the live app, by walking these paths and reading the address, the breadcrumb,
the tab bar, the scroll position and `history.length` after each step: overview › Machines › a machine › Back;
Runs › a combination › its run › a time bar › Back; run › story run › conversation › a call › Back › Back;
Stories tab and Setup tab from a story-run page › Back; story page and machine page by address. The code behind
each finding is named so the fix is a known change, not a search.

### Summary

The site has two navigation systems that disagree about what a place is. The address bar and the breadcrumb
treat entity pages as places: a combination, a run, a story run, a conversation, a call. The top bar treats
Runs, Machines and Setup as a remembered choice (a `localStorage` key, `App.tsx:27`) that is not in the
address at all, while the fourth tab, Stories, is a page. So `#/`, the one address every "Overview" crumb and
every Back-to-the-top leads to, is three different screens depending on what was clicked last, and the
breadcrumb cannot name the level the reader came through (Machines, Stories) because that level has no
address. That is the "wrong level": Back and the crumb do go where they say, but where they say is not a
fixed place.

Three further things make the trail feel loose. The breadcrumb's depth and wording differ by page (a machine
page is "Overview › gruntus", a story page is "Overview › vidi story 3", a combination page omits the pack the
story page includes). The tab bar highlights nothing on most pages, so the reader's sense of section is lost as
soon as they leave the overview. And the router scrolls to the top on every address change, Back included
(`router.ts:8`), so Back from a call page returns to the top of a 300-row conversation, not to the row that was
clicked.

The fix is one system: every screen a reader can stand on has an address, the tabs are links to the top of
their sections, the breadcrumb is the address spelled out, and Back restores what the reader was looking at.

### Critical Issues

#### Issue: `#/` is three different screens, so "Overview" and Back have no fixed target
**Current State**: Runs, Machines and Setup are a `tab` state in `App.tsx:88` saved under
`benchmarker:tab:v1`; choosing one from an entity page sets `location.hash = "#/"` (`App.tsx:91`). The
breadcrumb's first crumb is always `#/` (`EntityLinks.tsx:52`), `RemoveMachine` goes to `#/`
(`MachineHeader.tsx:38`), the not-found page's "Back to the overview" goes to `#/`. Machine pages live at
`#/m/<name>`, under no section. Verified: after opening Setup from a story-run page and pressing Back, every
"Overview" crumb on the site opens Setup until Runs is clicked again; from a machine page, Back lands on `#/`
showing Machines only because Machines was the last tab chosen.
**Problem**: The reader cannot predict what "Overview" or Back will show, and nothing on the screen explains
why it changed. A shared or bookmarked `#/` opens a different screen on another machine. The breadcrumb
cannot say "Overview › Machines › gruntus" because "Machines" has no address to link to.
**Recommendation**: Give each section an address and drop the remembered tab:
- `#/` is Runs, always. "Overview" in the breadcrumb means this screen and nothing else.
- `#/machines` is the Machines index; machine pages move to `#/machines/<name>`. `#/m/<name>` keeps parsing
  as the same page for existing links.
- `#/setup` is Setup.
- `#/<pack>/stories` is a Stories index (the pack's stories, the list `StoryList` already draws beside a
  story), and story pages stay at `#/<pack>/s/<n>`. The Stories tab opens the index, not story 1.
The tabs become plain links to those four addresses; `chooseTab`, `TAB_KEY` and `loadTab` go. The last tab
the reader used is the browser's business (its history), not the app's.
**Impact**: Every "Overview", every Back and every bookmark lands on a screen the reader can name. The machine
and story pages gain the crumb level they lack (next issue).
**Implementation Notes**: `shared/routes.ts`: `Route` gains `machines`, `setup`, `stories` pages;
`machinesHref`, `setupHref`, `storiesHref(pack)`; `machineHref` changes prefix; `parseRoute` accepts both
prefixes. `App.tsx` renders by `route.page` alone. `e2e/links.spec.ts` "the tabs always go back to the
overview" (line 62) asserts the current behaviour (`Machines` from a run page → `#/`) and must change to
assert `#/machines`. Add one test per section address, and one that `#/` is Runs after Machines was visited.

#### Issue: The breadcrumb's levels and wording differ by page
**Current State** (read from the live pages):

| Page | Trail shown | Missing or odd |
|---|---|---|
| Combination | Overview › reference/opus-5.5 | no section level (fine once Overview is Runs) |
| Run | Overview › reference/opus-5.5 › v2-r1 | |
| Story run | … › v2-r1 › story 1 | lower case |
| Conversation | … › story 1 › Conversation | capitalised |
| Call | … › Conversation › call 1 | lower case |
| Story | Overview › vidi story 3 | no Stories level; the pack is in the label here and nowhere else |
| Machine | Overview › gruntus | no Machines level |

Trails are built per page by hand (`StoryPage.tsx:24`, `CombinationPage.tsx:48`, `RunPage.tsx:30`,
`StoryRunPage.tsx:20`, `ConversationPage.tsx:56`, `CallPage.tsx:49`, `MachinePage.tsx:24`).
**Problem**: A reader learns the trail's shape on one page and finds a different shape on the next. The story
and machine pages jump from "Overview" straight to the entity, so there is no crumb to click to see the other
stories or the other machines; the side list on the story page is the only way, and the machine page has none.
**Recommendation**: One trail per page kind, derived from the route, in one place:
- Runs: Overview › combination › run › Story N › Conversation › Call N
- Stories: Overview › Stories › Story N
- Machines: Overview › Machines › name
Section crumbs link to the section addresses from the previous issue. Labels are sentence case throughout
("Story 1", "Call 3"). The pack is not a crumb: it is the site-wide pack and version choice in the top bar,
and the address carries it for every page that needs it.
**Impact**: The trail reads the same way everywhere and every level in it is a place the reader can go.
**Implementation Notes**: a `trailFor(route, state): Crumb[]` in `shared/` or beside `Breadcrumb`, called by
every page; pages stop assembling crumbs. A unit test over every `Route` page kind pins each trail (MECE by
page kind), replacing the per-page assertions scattered through the e2e specs.

#### Issue: The tab bar highlights nothing on most pages
**Current State**: `aria-selected` is `route.page === "overview" && tab === t` (`App.tsx:139`), or
`route.page === "story"` for Stories. Verified on a story-run page: all four tabs unselected; on a story page,
Stories selected; on `#/` the stored tab is selected whatever brought the reader there.
**Problem**: The top bar is the one fixed element on every page and it stops saying where the reader is as
soon as they open a run. On the overview it can say the wrong thing (Machines selected on arrival from a run
page's Back, because Machines was stored).
**Recommendation**: Select the tab from the route's section: Runs for overview, combination, run, story run,
conversation and call pages; Stories for the stories index and story pages; Machines for the index and machine
pages; Setup for Setup. With section addresses this is a one-line derivation from `route.page`.
**Impact**: The reader always sees which of the four sections they are inside.
**Implementation Notes**: `sectionOf(route.page)` in `shared/routes.ts`; e2e: one assertion per page kind.

#### Issue: Back returns to the top of the page, not to where the reader was
**Current State**: `useRoute` calls `window.scrollTo(0, 0)` on every `hashchange` (`router.ts:8`), which
fires for Back and Forward as well as for links. Verified: conversation page scrolled to 1500 px › open call 1
› Back › conversation at 0 px. The run page happened to come back at 600 px because its content is in memory
and the browser's own restoration won; the conversation page loads its events after render, so the browser
restores to a short page and the app then scrolls to 0. So Back sometimes keeps the place and sometimes loses
it, which is worse than either alone.
**Problem**: The call page is reached from a row deep in a long list; losing the row on Back is the single most
repeated cost of reading a conversation (open a call, Back, scroll to find the row again, open the next). The
earlier review's "dead end" finding was the symptom of this.
**Recommendation**: Scroll to the top only for a new place (a link followed), never for Back or Forward, and
restore the saved position once the page has its data. Give each history entry a key
(`history.replaceState({key}, "")` on first sight), save `scrollY` for the current key before leaving, and on
`popstate` restore the key's position after the page reports it is laid out (the conversation page: after the
first events page lands; other pages: after render). Set `history.scrollRestoration = "manual"` so the browser
and the app stop competing.
**Impact**: Open a call, Back, and the row is under the cursor again.
**Implementation Notes**: `router.ts` owns the keys and the saved positions (a `Map` in memory is enough: a
reload is a new place). Pages that load asynchronously call a `restoreScroll()` from the router once ready;
`useConversation` already knows when the first page has arrived. e2e: scroll, open a call, Back, assert
`scrollY` within a few pixels of the saved value; and that a fresh link starts at 0.

### High Priority Improvements

#### Issue: The conversation page's choices are not in its address
**Current State**: The story, combination and run pages keep their choices (`?compare=`, `?metric=`) in the
address with `history.replaceState` (`useAddressParam.ts`), so Back to them finds the choice still made. The
conversation page keeps its kind chips, search text and time range in component state; only `?kind=` arrives
from a bar part and is never written back when a chip changes.
**Problem**: Open a conversation narrowed to tools with "write" in the search, open a call, Back: the chips and
search are reset to the default. The address cannot be shared to show a colleague the same narrowing.
**Recommendation**: `?kind=`, `?q=`, `?from=` and `?to=` (ms offsets into the story) through `useAddressParam`,
replaced not pushed, exactly as the other pages do. The strip's drag writes the range; clearing it removes the
parameters.
**Impact**: Back and sharing restore the view; one mechanism for page state across the site.

#### Issue: The call page's way back lands on the top of the conversation
**Current State**: The call page's "Back to the conversation" link and its Conversation crumb go to the
conversation's address with no row named; the page's own next and previous links step between calls without
labels (carried over from Part 2).
**Recommendation**: The link targets the row: `…/conversation?turn=<idx>` scrolls that turn into view and
marks it, the same path the strip's click uses (`ConversationPage.tsx:78`). With the scroll fix above the
browser's Back does the same without the parameter.
**Impact**: Two reliable ways back to the row: the browser's and the page's.

#### Issue: Tab clicks and the search box push history entries with `location.hash =`
**Current State**: `App.tsx:91` and `:138`, `SearchBox.tsx:65`, `MachineHeader.tsx:38` set `location.hash`.
**Problem**: None for Back (verified: Back from Setup returns to the story-run page), but these are the only
places that navigate by assignment rather than by an `<a href>`, so they cannot be opened in a new tab, are
invisible to the link sweep in `links.spec.ts`, and are the places the stored-tab logic lives.
**Recommendation**: Tabs become `<a href>` (previous issue). The search box's result rows are already
links (`SearchBox.tsx:111`); Enter follows the highlighted row's href the same way instead of assigning the
hash. `RemoveMachine` goes to `#/machines`.

### Medium Priority Enhancements

- **Crumb capitalisation**: "story 1", "Conversation", "call 1" become "Story 1", "Conversation", "Call 1"
  (folded into the trail issue above).
- **The run crumb's style**: on the story-run page the run crumb is a `RunLink` (run colour), on the run page
  the current run is plain text. Once trails come from one function this difference goes with it.
- **A Stories index**: the Stories tab opens the pack's first story and relies on the side list for the rest.
  With `#/<pack>/stories` the tab, the crumb and the side list's heading all go to the same list.
- **`#/m/`** in the address is a code, `#/machines/` is a word. Keep the old form parsing.

### Low Priority Suggestions

- The not-found page's "Back to the overview" becomes "Back to runs" when Overview means Runs.
- A page title (`document.title`) per route ("v2-r1 · reference/opus-5.5 · Benchmarker") so the browser's
  Back menu and tab strip name the places; today every entry reads "Benchmarker".

### Positive Observations

- Every entity reference is a real link with an href (combination, run, story run, machine, bar parts), so
  Back, middle-click and copying the address all work between entity pages; verified run › story run ›
  conversation › call › Back › Back returns through each page.
- Page choices on the story, combination and run pages are kept in the address by replacement, with the
  reasoning written in `useAddressParam.ts`. This is the pattern the rest should follow.
- The breadcrumb is pinned under the top bar and reads as a trail; the not-found page names the missing id and
  links back.
- `links.spec.ts` already pins crumbs and tab targets, so each change above has a test to change rather than a
  test to invent.

## Part 3: the conversation page (3 October 2026)
Review of the benchmarker's conversation page, 3 October 2026, at
`#/vidi/r/<stack>/v2-gufo05-r1/s/1/conversation` (a story still running: 154 model calls, 170 tool calls, 651 events,
52 minutes), 1148 px wide. Reviewed as a reader who has just clicked a time bar to see what the agent did.

### Status (3 October 2026, later the same day)

The four Critical issues below are built and live: one list of turns with the overview as the only control surface
(kind chips, one search, the strip's click and drag), one row per turn with its tools under it and its engine request
in its figures, an SVG strip of calls, tool bands and compaction lines, and the Figures column folded into the Turn
column. Of the High items, m:ss times, one search and the call page opening folded are done; the labelled next and
previous turns are not. The Medium and Low items stand.

### Summary

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

### Critical Issues

#### Issue: The overview controls its siblings instead of describing and navigating one thing
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

#### Issue: One happening, several rows
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

#### Issue: The timeline draws idle time as blocks and hides the conversation's shape
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

#### Issue: The Figures column overlaps the Text column
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

### High Priority Improvements

#### Issue: Two searches, two counts
**Current State**: Each section (and the in-order list) has its own magnifier that opens its own search box in
its heading; the count shows "n of N" there while searching.
**Problem**: With one list the search is the overview's; a second one in the list's heading is a second place to
look.
**Recommendation**: One search box on the overview (beside the chips), always visible, placeholder "Search the
conversation"; the list heading shows "n of N" when the search or the chips narrow it. Keep the hit marking.

#### Issue: Time is in seconds for an hour-long story
**Current State**: The "At" column shows "1,234.5 s".
**Problem**: Nobody reads 1,234 s as 20 minutes.
**Recommendation**: `m:ss` past a minute (`20:34`), seconds under it; the hover gives the clock time.

#### Issue: The call page is a dead end from the list
**Current State**: "call N" opens the call page, which heads with "Call N of M" and a back link (added this
afternoon).
**Recommendation**: Keep it, and add the next and previous turns' first line as the links' labels so the reader
knows what they are stepping to. Also open the call page's thinking and text folded at five lines with the same
+ button, so a 48,000-character thinking block does not fill the screen on arrival.

### Medium Priority Enhancements

- **Kind badges and bar colours agree** (model purple, tools green, compaction red): keep this, and use the same
  colours for the timeline's marks and the chips' dots, so the three places read as one legend.
- **The fold button** (+) sits at the right edge of a wide cell, far from the text it unfolds; put it at the end
  of the fifth line, like "… more".
- **The sticky section heading** is now the one list's heading; pin the overview's chips and search with it, so
  narrowing is always at hand while scrolling 300 rows.
- **"so far"** on a running story is the only sign the list grows; a small "live" mark on the heading with the
  time of the last event would say it plainly.

### Low Priority Suggestions

- Drop the twisty on a page with one section; keep it only if a second section (readings, requests as tables)
  returns.
- The breadcrumb's last crumb reads "Conversation"; "Conversation of story 1" reads better when the story-run
  header is scrolled away.

### Positive Observations

- Pinned column heads and compact numeric columns work and should stay.
- Verbatim agent text is marked as such (`data-quoted="agent"`) and the search marks hits inside it; this is the
  right boundary between results and the app's own words.
- Folding cells at five lines keeps a 300-row list scannable.
- The page follows along without a reload and says "so far" while the story runs; the API behind it needs no
  change for any of the above.
