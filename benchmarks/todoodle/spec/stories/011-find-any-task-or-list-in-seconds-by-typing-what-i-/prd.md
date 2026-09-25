# PRD

A single Finder, reachable from anywhere, that finds tasks and lists by what people remember, stays live while collaborators change things, and turns a failed search into a new task.

## Problem

To reach a task today you must remember which list it is in. People remember words ("boiler", "Sam's birthday"), not places. In a shared workspace they often never knew the place, because someone else filed the task. Completed tasks vanish from view entirely. As workspaces grow, people scroll through every list, give up, and add duplicates (three "buy milk" tasks on a shared list). Getting to a project by name in a long sidebar is slow too.

## Solution

A single Finder opens from anywhere in the workspace. As people type, it shows matching lists (Today, Inbox, projects) straight away and matching tasks moments later, grouped by list, with the matched words highlighted and each task's list and date visible. Opening a task takes you to its list with the task focused and its details open, so you stay in context. You can complete, date or move a task without leaving the Finder. Results stay current while collaborators add, change or delete tasks, without the highlighted result jumping away. If nothing matches, the first option is to add a task with what you typed, which turns 'is it already there?' into one motion. Completed tasks can be included on demand. Matching forgives case and accents and accepts words in any order. What people search for is never recorded by Todoodle; recent searches stay only in their own browser and can be cleared.

## User Experience

**Entry points**
- Keyboard: '/' or Cmd/Ctrl+K from anywhere in the workspace (ignored while typing in another field).
- Desktop: a search field at the top of the sidebar, showing the Cmd/Ctrl+K hint; clicking it opens the Finder.
- Phone: a magnifying-glass button in the header opens the Finder as a full-screen sheet.

**Golden path**
1. User presses '/'. A panel opens near the top of the screen with the text box focused; the placeholder names the workspace ('Search My Todoodle...').
2. They type 'boiler'. A 'Lists' group updates instantly; a 'Tasks' group shows '3 results' a moment later. Each task row shows a checkbox, the name with 'boiler' highlighted, its list (colour dot and name, or Inbox) and its date chip.
3. The first result is highlighted. Up/Down move the highlight. Enter opens the task: the app goes to that task's list, the task is focused and its details open. Closing the details leaves them in that list on that task.
4. Escape closes the Finder and returns focus to where they were.

**Acting in place**
- On the highlighted task: Space completes it (with the usual Undo), D opens the date picker, M opens Move to. The Finder stays open and the result updates.
- A footer lists these keys on keyboard devices; it is hidden on touch.

**Empty query**
- Up to 5 recent searches for this workspace on this browser (with 'Clear recent'), then Today, Inbox and the 3 most recently viewed projects.

**No results**
- 'No tasks match "xyz"', then a highlighted 'Add task "xyz" -> Inbox' (destination follows the list you were in), then 'Try including completed tasks' when that is off. Enter adds the task, closes the Finder and focuses the new task.

**Many results**
- The first 50 are shown with 'Showing the first 50 - add another word to narrow it down.'

**Live changes while open**
- If a collaborator changes a matching task, its row updates in place. New matches appear; tasks deleted, completed (when completed are hidden) or no longer matching disappear. The highlighted task stays highlighted if it is still a result; if it disappears, the highlight moves to the next result.
- If the project containing a result is deleted, its tasks leave the results.

**Loading, offline, error**
- Previous results stay visible while new ones load; placeholder rows appear only if nothing arrives within a short moment, so fast searches don't flicker.
- Offline: lists still match; the task group says 'Can't search tasks while offline.' The typed text stays.
- Failure: 'Search failed. Try again' with a retry button; the typed text stays.

**Phone**
- Full-screen sheet with a back arrow, text box auto-focused, keyboard 'Search' key. Rows are large and easy to tap. Tap opens a task; a visible Complete button (and a swipe) completes it with Undo.

**Non-behaviours**
- Does not search other workspaces.
- Does not support query syntax or saved filters.
- Does not send searches anywhere except this workspace's server, and the server never records them.
- Does not announce every live change to screen readers; only the updated result count.

## Open the Finder by keyboard

> Anchor: `prd.entry_keyboard`

WHEN a user presses '/' or Cmd/Ctrl+K while not typing in another field THE SYSTEM SHALL open the Finder with its text box focused.

## Visible entry points

> Anchor: `prd.entry_visible`

THE SYSTEM SHALL provide a visible search entry point in the sidebar on wide screens and in the header on narrow screens that opens the Finder.

## Scoped to this workspace

> Anchor: `prd.workspace_scope`

THE SYSTEM SHALL search only the current workspace and SHALL name that workspace in the Finder's placeholder.

## Go to lists by name

> Anchor: `prd.list_matches`

WHEN a user types in the Finder THE SYSTEM SHALL show Today, Inbox and projects whose names match, within 50 ms of the keystroke.

## Find tasks by content

> Anchor: `prd.task_matches`

WHEN a user has typed at least 2 characters THE SYSTEM SHALL show tasks whose name or description contains every typed word, in any order.

## Forgiving matching

> Anchor: `prd.forgiving_match`

THE SYSTEM SHALL match regardless of letter case and accents, so that 'cafe' finds 'Café'.

## Typed symbols match literally

> Anchor: `prd.literal_symbols`

THE SYSTEM SHALL treat every typed character, including percent signs and underscores, as literal text to find.

## Grouped, informative results

> Anchor: `prd.result_presentation`

THE SYSTEM SHALL group results into Lists and Tasks and SHALL show each task's name, its list and its due date.

## Highlighted matches

> Anchor: `prd.match_highlight`

THE SYSTEM SHALL highlight the matched words in results using a style that does not rely on colour alone.

## Useful ordering

> Anchor: `prd.result_order`

THE SYSTEM SHALL order task results with open tasks before completed ones, name matches before description-only matches, then by earliest due date, then by most recently changed.

## Deleted things never appear

> Anchor: `prd.exclusions`

IF a task is deleted or belongs to a deleted project THEN THE SYSTEM SHALL NOT show it in results.

## Include completed on demand

> Anchor: `prd.include_completed`

WHILE 'Include completed' is on THE SYSTEM SHALL include completed tasks in results, and SHALL remember the setting on this browser.

## Result limit with guidance

> Anchor: `prd.result_limit`

IF more than 50 tasks match THEN THE SYSTEM SHALL show the first 50 and a message suggesting another word to narrow the search.

## Open a task in context

> Anchor: `prd.open_in_context`

WHEN a user opens a task result THE SYSTEM SHALL show that task's list with the task focused and its details open.

## Go to a list

> Anchor: `prd.open_list`

WHEN a user opens a list result THE SYSTEM SHALL show that list.

## Act without leaving

> Anchor: `prd.act_in_place`

WHILE a task result is highlighted WHEN the user presses Space, D or M THE SYSTEM SHALL complete it with Undo, open its date picker, or open Move to, respectively, without closing the Finder.

## Results stay live

> Anchor: `prd.live_results`

WHILE the Finder is open with a query WHEN a collaborator adds, changes, completes, moves or deletes a task THE SYSTEM SHALL update the results within 5 seconds without the user retyping.

## Highlight never jumps away

> Anchor: `prd.stable_selection`

WHEN results change while a task is highlighted THE SYSTEM SHALL keep that task highlighted if it is still a result, and otherwise SHALL highlight the next result.

## Turn a failed search into a task

> Anchor: `prd.add_from_search`

WHEN no tasks match THE SYSTEM SHALL offer, as the first option, to add a task named with the typed text to the list the user was viewing.

## Recent searches stay local

> Anchor: `prd.recent_searches`

WHILE the Finder is open with no query THE SYSTEM SHALL show up to 5 recent searches for this workspace kept only on this browser, with an option to clear them.

## Searches are never recorded

> Anchor: `prd.query_privacy`

THE SYSTEM SHALL NOT record search text in server logs, error reports or anywhere outside the searching browser.

## Offline search

> Anchor: `prd.offline_search`

WHILE the user is offline THE SYSTEM SHALL keep matching lists, SHALL say that tasks can't be searched, and SHALL keep the typed text.

## Search failure recovery

> Anchor: `prd.search_error`

IF a task search fails THEN THE SYSTEM SHALL show a retry option and SHALL keep the typed text and any previous results.

## No flicker while typing

> Anchor: `prd.no_flicker`

WHILE new results are loading THE SYSTEM SHALL keep showing the previous results and SHALL show placeholder rows only if nothing arrives within 300 ms.

## Close and return

> Anchor: `prd.close_return`

WHEN a user closes the Finder THE SYSTEM SHALL return focus to the control or place that was focused before it opened.

## Phone layout

> Anchor: `prd.mobile_sheet`

WHILE the screen is narrower than a tablet THE SYSTEM SHALL present the Finder full-screen with touch targets at least 44 pixels tall and a visible Complete control on each task result.

## Screen reader support

> Anchor: `prd.screen_reader`

THE SYSTEM SHALL announce the number of task results politely at most every half second and SHALL expose the Finder as a searchable list that can be operated entirely by keyboard.

## Out of scope

- Query syntax and saved filters (e.g. 'today & #Home', priorities, labels)
- Searching across workspaces
- Duplicate detection while typing in quick add ('similar task exists') - natural follow-up story
- Search inside comments or attachments (neither exists)
- Fuzzy/typo-tolerant matching

## Constraints

- Task results for a workspace with 5,000 tasks within 300 ms of server time at the 95th percentile when measured locally.
- List matches within 50 ms of a keystroke.
- Search text up to 200 characters.
- Works with keyboard only, touch only, and screen readers; WCAG 2.2 AA contrast in light and dark themes.
- Follows the workspace access rules: a browser without access learns nothing, including whether any task exists.

