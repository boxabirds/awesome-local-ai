# PRD

A single Finder, reachable from anywhere, that finds tasks and lists by what people remember, stays live while collaborators change things, and turns a failed search into a new task.

## Problem

To reach a task today you must remember which list it is in. People remember words ("boiler", "Sam's birthday"), not places. In a shared workspace they often never knew the place, because someone else filed the task. Completed tasks vanish from view entirely. As workspaces grow, people scroll through every list, give up, and add duplicates (three "buy milk" tasks on a shared list). Getting to a project by name in a long sidebar is slow too.

## Solution

A single Finder opens from anywhere in the workspace. As people type, it shows matching lists (Today, Inbox, projects) straight away and matching tasks moments later, grouped by list, with the matched words highlighted and each task's list and date visible. Opening a task takes you to its list with the task focused and its details open, so you stay in context. From an action bar beside the results you can complete, date or move the highlighted task without leaving the Finder, and undo a completion right there; typing in the search box never triggers an action, so any words can be searched. Results stay current while collaborators add, change or delete tasks, without the highlighted result jumping away. If nothing matches, the first option is to add a task with what you typed, which turns 'is it already there?' into one motion. Completed tasks can be included on demand. Matching forgives case and accents and accepts words in any order. What people search for is never recorded by Todoodle; recent searches stay only in their own browser and can be cleared.

## User Experience

**Entry points**
- Keyboard: '/' or Cmd/Ctrl+K from anywhere in the workspace (ignored while typing in another field or while another panel, sheet or picker is open).
- Desktop: a search field at the top of the sidebar, showing the Cmd/Ctrl+K hint; clicking it opens the Finder.
- Phone: a magnifying-glass button in the header opens the Finder as a full-screen sheet.
- While the Finder is open, the task list's own keys (Q, E, J/K, arrows, '?' and so on) do nothing; only the Finder responds.

**Golden path**
1. User presses '/'. A panel opens near the top of the screen with the text box focused; the placeholder names the workspace ('Search My Todoodle...').
2. They type 'boiler'. A 'Lists' group updates instantly; a 'Tasks' group shows '3 results' a moment later. Each task row shows a checkbox mark (a picture, not a control), the name with 'boiler' highlighted, its list (colour dot and name, or Inbox) and its date chip.
3. The first result is highlighted. Up/Down move the highlight. Enter opens the task: the app goes to that task's list, the task is focused and its details open. Closing the details leaves them in that list on that task.
4. Escape closes the Finder and returns focus to where they were.

**Acting in place (action bar)**
- Everything typed in the text box is search text. Space, 'd' and 'm' type normally, so 'boiler service', 'dentist' and 'move mum' can be searched.
- When a task is highlighted, an action bar below the results reads 'Actions for "Book boiler service"' with three buttons: **Complete** (Reopen for a completed task), **Set date** and **Move**. It is not part of the results.
- Tab from the text box moves into the action bar; Left/Right move between its buttons; Enter or Space presses one; Shift+Tab goes back to the text box. When a list or 'Add task' is highlighted there is no action bar.
- Mouse users can click the bar's buttons directly.
- Set date opens the date picker in the middle of the screen; Move opens Move to. Closing either returns to the Set date / Move button, with the Finder still open.
- After Complete, a line inside the Finder reads 'Completed "Book boiler service" · Undo'. Undo there reopens the task. (The usual Undo toast also appears, but it can sit behind the Finder, so the line inside is the one people can reach.) The line clears after the undo window or when the search changes.
- If the task an action bar is showing disappears (for example a collaborator deletes it), focus goes back to the text box and nothing is applied to a different task.
- Footer on keyboard devices: '↑↓ move · Enter open · Tab actions · Esc close'. It is hidden on touch.

**Empty query**
- Up to 5 recent searches for this workspace on this browser (with 'Clear recent'), then Today, Inbox and the 3 most recently viewed projects.

**No results**
- 'No tasks match "xyz"', then a highlighted 'Add task "xyz" -> Inbox' (destination follows the list you were in), then 'Try including completed tasks' when that is off. Enter adds the task, closes the Finder and focuses the new task.

**Many results**
- The first 50 are shown with 'Showing the first 50 - add another word to narrow it down.'

**Live changes while open**
- If a collaborator changes a matching task, its row updates in place. New matches appear; tasks deleted, completed (when completed are hidden) or no longer matching disappear. The highlighted task stays highlighted if it is still a result; if it disappears, the highlight moves to the next result.
- If the project containing a result is deleted, its tasks leave the results.
- When many tasks change at once (for example a bulk reschedule), the results are refreshed from the server.

**Loading, offline, error**
- Previous results stay visible while new ones load; placeholder rows appear only if nothing arrives within a short moment, so fast searches don't flicker.
- Offline: lists still match and can be opened; the task group says 'Can't search tasks while offline.' The typed text stays. The action bar's buttons and Undo are shown as unavailable ('Offline — actions unavailable').
- Failure: 'Search failed. Try again' with a retry button; the typed text stays.
- If access to the workspace is lost or its link was changed while searching, the Finder closes and the app shows the same page it shows anywhere else for that situation.

**Phone**
- Full-screen sheet with a back arrow, text box auto-focused, keyboard 'Search' key. Rows are large and easy to tap. Tap opens a task. Press and hold a result to show the action bar (Complete, Set date, Move) at the bottom of the sheet. Rows have no buttons inside them and there is no swipe.

**Non-behaviours**
- Does not search other workspaces.
- Does not support query syntax or saved filters.
- Does not send searches anywhere except this workspace's server, and the server never records them.
- Does not announce every live change to screen readers; only the updated result count.
- Does not use single-letter keys inside the search box for actions.
- Does not support swipe gestures.

## Open the Finder by keyboard

> Anchor: `prd.entry_keyboard`

WHEN a user presses '/' or Cmd/Ctrl+K while not typing in another field and no other overlay is open THE SYSTEM SHALL open the Finder with its text box focused. WHILE the Finder is open THE SYSTEM SHALL NOT act on any other workspace or task-list shortcut.

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

WHILE a task result is highlighted WHEN the user presses Tab from the search box (or, on touch, presses and holds the result) THE SYSTEM SHALL show an action bar for that task, separate from the results, offering Complete, Set date and Move; SHALL carry out the chosen action without closing the Finder; and after completing SHALL show, inside the Finder, 'Completed "<task name>" · Undo' with a working Undo. THE SYSTEM SHALL treat every character typed in the search box, including spaces, 'd' and 'm', as search text that never triggers an action, so that 'boiler service' and 'dentist' can be typed normally.

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

WHILE the user is offline THE SYSTEM SHALL keep matching lists, SHALL say that tasks can't be searched, SHALL keep the typed text, and SHALL show the action bar's Complete, Set date, Move and the status line's Undo as unavailable.

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

WHILE the screen is narrower than a tablet THE SYSTEM SHALL present the Finder full-screen with touch targets at least 44 pixels tall, SHALL open a task when its result is tapped, and SHALL show the action bar (Complete, Set date, Move) for a result that is pressed and held; results SHALL contain no buttons of their own and SHALL NOT respond to swipes.

## Screen reader support

> Anchor: `prd.screen_reader`

THE SYSTEM SHALL announce the number of task results politely at most every half second, SHALL expose the Finder as a searchable list whose results contain no controls, with task actions in a separate labelled toolbar, and SHALL be operable entirely by keyboard.

## Out of scope

- Query syntax and saved filters (e.g. 'today & #Home', priorities, labels)
- Searching across workspaces
- Duplicate detection while typing in quick add ('similar task exists') - natural follow-up story
- Search inside comments or attachments (neither exists)
- Fuzzy/typo-tolerant matching
- Swipe gestures on results (no list view in Todoodle uses swipe; phone users act through the press-and-hold action bar)
- Single-letter action keys inside the search box (the box is for text only; actions live in the action bar)

## Constraints

- Task results for a workspace with 5,000 tasks within 300 ms of server time at the 95th percentile when measured locally.
- List matches within 50 ms of a keystroke.
- Search text up to 200 characters.
- Works with keyboard only, touch only, and screen readers; WCAG 2.2 AA contrast in light and dark themes.
- Follows the workspace access rules: a browser without access learns nothing, including whether any task exists.

