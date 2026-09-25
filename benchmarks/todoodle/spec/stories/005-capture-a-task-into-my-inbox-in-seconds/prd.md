# PRD

Fast task capture into the Inbox, by keyboard or click, from anywhere in the workspace.

## Problem

The core promise of a Todoist-style app is getting a thought out of your head before it evaporates. If adding a task takes more than a keystroke and a sentence, people stop using the app. Users also need a default place for tasks they haven't sorted yet.

## Solution

Every workspace has an Inbox. From anywhere in the workspace, pressing a single key (or clicking 'Add task') opens a quick-add box; typing a name and pressing Enter saves the task into the Inbox (or the project currently being viewed) and keeps the box open for the next one. Tasks appear instantly in the list.

## User Experience

**Golden path (desktop)**
1. User is in a workspace viewing the Inbox.
2. They press Q (or click '+ Add task' at the bottom of the list).
3. An inline box appears with the name field focused (placeholder 'Task name'), an optional 'Description' field below, and a small chip showing where the task will land: '→ Inbox' (or '→ Work' when viewing a project, '→ Today' when viewing Today).
4. They type 'Buy milk' and press Enter. The task appears at the bottom of the list immediately; the fields clear and the name field stays focused, ready for the next task.
5. Pressing Escape closes the box.

**Golden path (phone)**
1. On a narrow screen the sidebar is hidden behind a ☰ menu button in the header; the list fills the screen.
2. A round '+' button floats at the bottom-right. Tapping it opens quick add as a panel sitting directly above the on-screen keyboard, with the name field focused.
3. Tapping ☰ slides the sidebar in; choosing Inbox (or any list) closes it.

**Structure**
- Sidebar (desktop) / drawer (phone): Inbox (with open-task count), Today (story 8), Projects (story 7).
- Main area: list of open tasks, each with a round checkbox, name, and a one-line description preview in muted text if present.
- Every tappable control is at least fingertip-sized on touch screens.
- The app follows the device's light or dark appearance.

**Keys in quick add**
- Name field: Enter adds the task; Tab moves to Description.
- Description field: Enter starts a new line; ⌘/Ctrl+Enter adds the task; Shift+Tab goes back to the name.

**Moving around the list with the keyboard**
- The task list is a single stop when tabbing through the page. Inside it, ↑/↓ (or k/j) move between tasks and Home/End jump to the first/last task. The focused task is clearly highlighted.
- Pressing ? (when not typing) opens a panel listing every keyboard shortcut; Escape closes it.

**Length limits**
- Nothing the user types or pastes is ever cut off. As the name approaches its limit a counter appears ('32 characters left'); past the limit it turns red ('12 characters over') and Add is disabled until the text is shortened. Same for the description.

**Alternate flows**
- Loading: while the Inbox loads, grey placeholder rows are shown (no full-page spinner); the sidebar is usable immediately.
- Load fails: 'Couldn't load your tasks.' with a Try again button.
- Empty Inbox: friendly illustration and 'Your Inbox is clear. Press Q to add a task.' (on phones: 'Tap + to add a task.').
- Empty or whitespace-only name: Add button disabled; Enter does nothing.
- Save fails: the task stays in the list marked 'Couldn't save this task' with Retry and Discard; the typed text is never lost. Screen-reader users hear the failure announced; while a task is still saving it is marked as busy.
- Shortcut pressed while typing in another field: ignored (does not hijack typing).

**Non-behaviours**
- No natural-language date parsing in MVP (typing 'tomorrow' is just text).
- No labels, priorities, or subtasks in MVP.
- Never trims or truncates what the user typed to make it fit.

## Every workspace has an Inbox

> Anchor: `prd.inbox_exists`

THE SYSTEM SHALL provide every workspace with an Inbox that cannot be renamed or deleted.

## Quick add saves a task

> Anchor: `prd.quick_add`

WHEN a user submits a non-empty task name in quick add THE SYSTEM SHALL save the task to the Inbox, or to the project currently being viewed, and show it in the list immediately.

## Keyboard shortcut opens quick add

> Anchor: `prd.quick_add_shortcut`

WHEN a user presses the quick-add key while not typing in another field THE SYSTEM SHALL open quick add with the name field focused.

## Blank tasks are rejected

> Anchor: `prd.reject_blank`

IF the task name is empty or only whitespace THEN THE SYSTEM SHALL NOT create a task.

## Failed saves never lose text

> Anchor: `prd.failed_save_recovery`

IF saving a new task fails THEN THE SYSTEM SHALL keep the task text visible with options to retry or discard.

## New tasks go to the end

> Anchor: `prd.task_order`

THE SYSTEM SHALL show open tasks in the order they were added, newest last, until the user reorders them.

## Over-long tasks are never saved

> Anchor: `prd.length_limits`

IF a task name is longer than 500 characters or a description is longer than 5,000 characters THEN THE SYSTEM SHALL NOT save the task, including when the request did not come through the quick-add box.

## Retrying never creates duplicates

> Anchor: `prd.retry_no_duplicate`

WHEN a user retries a task whose save appeared to fail THE SYSTEM SHALL end up with exactly one copy of that task, even if the earlier attempt actually reached Todoodle.

## Quick add stays ready for the next task

> Anchor: `prd.quick_add_stays_open`

WHEN a task is submitted from quick add THE SYSTEM SHALL clear the name and description and keep quick add open with the name field focused.

## Escape closes quick add

> Anchor: `prd.quick_add_escape`

WHEN the user presses Escape while quick add is open THE SYSTEM SHALL close quick add without creating a task.

## Empty Inbox explains what to do

> Anchor: `prd.empty_inbox`

WHILE the Inbox has no open tasks THE SYSTEM SHALL show an empty state that tells the user how to add a task.

## Follows light or dark appearance

> Anchor: `prd.color_scheme`

THE SYSTEM SHALL follow the device's light or dark appearance setting while keeping WCAG 2.2 AA contrast for text and controls.

## Saving status reaches screen readers

> Anchor: `prd.save_status_accessible`

WHILE a new task is saving THE SYSTEM SHALL mark it as busy to assistive technology, and IF saving fails THEN THE SYSTEM SHALL announce the failure immediately.

## Failed load offers Try again

> Anchor: `prd.load_failure_retry`

IF the task list fails to load THEN THE SYSTEM SHALL show 'Couldn't load your tasks.' with a Try again action that reloads the list.

## Placeholder rows while loading

> Anchor: `prd.loading_placeholder`

WHILE the task list is loading THE SYSTEM SHALL show placeholder rows in the list area and keep the sidebar usable.

## Touch targets are fingertip-sized

> Anchor: `prd.touch_targets`

WHILE the device has no hover-capable pointer THE SYSTEM SHALL give every interactive control in the app shell, task list and quick add a touch target of at least 44 by 44 pixels.

## Floating add button on phones

> Anchor: `prd.mobile_add_button`

WHILE the screen is narrower than 768 pixels or the device has no hover-capable pointer THE SYSTEM SHALL show a floating add button that opens quick add positioned above the on-screen keyboard.

## Sidebar becomes a drawer on phones

> Anchor: `prd.mobile_drawer`

WHILE the screen is narrower than 768 pixels THE SYSTEM SHALL hide the sidebar behind a menu button and show it as a drawer that closes when a list is chosen.

## ? lists all keyboard shortcuts

> Anchor: `prd.shortcut_help`

WHEN the user presses ? while not typing in a field THE SYSTEM SHALL show a panel listing every available keyboard shortcut and what it does.

## Task list is one tab stop

> Anchor: `prd.list_single_tab_stop`

THE SYSTEM SHALL make the task list a single stop in the page's Tab order, landing on the most recently focused task (or the first task).

## Arrow keys move between tasks

> Anchor: `prd.list_keyboard_nav`

WHILE focus is on a task in the list WHEN the user presses Up, Down, k, j, Home or End THE SYSTEM SHALL move focus to the previous, next, previous, next, first or last task respectively.

## Quick add shows where the task will go

> Anchor: `prd.destination_chip`

WHILE quick add is open THE SYSTEM SHALL show the name of the list the new task will be added to.

## Command/Ctrl+Enter adds from anywhere in quick add

> Anchor: `prd.modifier_enter_submit`

WHEN the user presses Command+Enter or Ctrl+Enter in either quick-add field THE SYSTEM SHALL add the task as if Add were pressed.

## Enter in description starts a new line

> Anchor: `prd.description_newline`

WHILE the description field has focus WHEN the user presses Enter THE SYSTEM SHALL insert a new line and SHALL NOT add the task.

## Remaining characters shown near the limit

> Anchor: `prd.length_counter`

WHILE a task name or description is at 90% or more of its limit THE SYSTEM SHALL show how many characters remain.

## Typed text is never cut off

> Anchor: `prd.no_truncation`

IF a user types or pastes a task name or description longer than its limit THEN THE SYSTEM SHALL NOT remove any of the text, and SHALL show how many characters are over the limit and prevent adding the task until it fits.

## Out of scope

- Natural-language dates, priorities, labels, subtasks, recurring tasks
- Drag-to-reorder (follow-up)
- Global quick add from outside the app (browser extension, email-in)

## Constraints

- Task name limit 500 characters; description limit 5,000 characters. The counter appears at 90% of a limit.
- New task visible in under 100 ms of pressing Enter (optimistic display).
- Fully usable by keyboard alone; screen-reader labels on all controls.
- Phone layout applies below 768 px wide; touch targets at least 44×44 px.
- Text and controls meet WCAG 2.2 AA contrast in both light and dark appearance.

