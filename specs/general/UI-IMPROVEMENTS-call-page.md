# UI/UX Improvements: the call page

Review of one call page (Swift 1.5, v2-fresh-r2, story 1, call 5: 104,291 characters of thinking, 31,527 output tokens),
3 October 2026, from the owner's report that its output tokens, input tokens and tool calls "are not there", and the
owner's design for the fix. Checked on the live page by structure and position only (no thinking text read).

## Status (3 October 2026, evening, after the owner's review of the built page)

Three corrections to the build: the items are in the call's own order, Input, Thinking, Tool calls, Output; the chevron is
the conversation page's twisty size (20 px), not a text glyph; and Output and Input carry the call's content, not an
explanation of the page. Output: the model's text (or "none: the model only called tools") and the tool calls it issued
with their arguments; the token split is one small line, the explanation is the figure's hover. Input: what was new to
the call, the tool results the call before returned (a tool named once, its kind only where it says more), or the
story's opening message for the first call.

## Summary

Every figure is on the page, and none of it can be reached. The four figures sit in a row above a thinking box that is
592 px tall, scrolls inside itself and holds all 104,291 characters, so the wheel is trapped in it for as long as the
cursor is over it; the text, the tool call and its result sit below that box. Three things that can each be enormous
(thinking, output, input) share one page with scrolls inside the scroll, and the figures are in characters in one place
and tokens in another. The page also repeats a story line (status, held-out result, agent time) that has nothing to do
with a call.

## Critical Issues

### Issue: scrolls within scrolls hide the rest of the call
**Current State**: thinking, text and each tool's arguments and result are boxes of at most 592 px that scroll inside
themselves, below a figures row.
**Problem**: with the cursor over a very long box the wheel scrolls it, not the page. The tool call and result below it are
out of reach, and a reader cannot tell the box is not the end of the page.
**Recommendation**: no box scrolls. The page is a stack of concertina items, each closed at first, each opening to its
whole content in the page's own flow. The open item's header pins under the app's pinned bar, so one click closes it
wherever the reader has scrolled to.
**Impact**: the call can be read from top to bottom with one scroll; a 100,000-character thinking costs one click and
one close.
**Implementation Notes**: the open body renders only when open (a closed 104k-character item costs nothing); headers are
buttons with `aria-expanded` and `aria-controls`; the pinned header uses the page's existing pinned-height variable.

## High Priority Improvements

### Issue: the figures are separate from what they describe, and in two units
**Recommendation**: the figure is in the item's heading, always in tokens: Thinking, Output, Input, Tool calls. Output and
Input are the record's own token counts. Tokens are not recorded per part of an output, so Thinking and Tool calls are the
call's output tokens shared out by characters of thinking, text and tool arguments, marked with "≈" and a hover that says
so; they add up to the output total. A client that withholds its thinking says so instead of a number.
**Impact**: one unit down the page; a reader sees at a glance that this call was 99.7% thinking.

### Issue: facts that are not about the call
**Current State**: a story line with the story's status, held-out result and agent time.
**Recommendation**: remove it. The breadcrumb names the story ("Story 1: Pan and zoom around an infinite board"); the
page's second row is the call (Call 5 of 73) with the way back and the calls either side.

## Medium Priority Enhancements

- **Output** opens to the call's visible text and the split of its tokens (thinking, text, tool calls).
- **Input** opens to what was read from the cache and what was new, and, for a call after the first, what the previous
  call's tools returned: that is the new input. It is fetched only when opened.
- **Tool calls** opens to each tool with its name, kind, arguments and result, whole.

## Low Priority Suggestions

- Open items could be kept in the address so a link opens the same one.
- The breadcrumb's story title only on this page for now; the story run and conversation pages could do the same.

## The page, top to bottom

```
Overview > combination > run > Story 1: Pan and zoom around an infinite board          <- the one breadcrumb row
Call 5 of 73     < Back to the conversation    < call 4    call 6 >                      <- the call
[v] Thinking     ~31,4xx tokens                                                         <- four items, closed
[v] Output       31,527 tokens
[v] Input        16,175 tokens
[v] Tool calls   1 call, ~xx tokens
```

## Positive Observations

- A call's page already holds everything: whole thinking, text, arguments and results, with the way back to its row.
- Agent text is marked as quoted data and never styled as the app's own words; that stays.
