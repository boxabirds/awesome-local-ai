# PRD

Due dates on tasks and a Today view combining today's and overdue tasks across projects.

## Problem

A list without dates can't answer the question people open a todo app to ask: 'What do I need to do today?' Overdue items get buried in projects and forgotten. Collaborators in different time zones may disagree about what 'today' means.

## Solution

Any task can have a due date, set from quick add or the task detail via a date picker with shortcuts (Today, Tomorrow, Next week, No date). A Today view gathers every open task due today or earlier across the Inbox and all projects, with overdue items grouped at the top. Dates are interpreted in each viewer's own local time zone.

## User Experience

**Golden path**
1. In quick add or task detail, user clicks the calendar button (or, with a task selected in a list, presses **D**).
2. The picker shows shortcuts, each with the date it resolves to: **Today · Fri 25 Sep**, **Tomorrow · Sat 26 Sep**, **This weekend · Sat 26 Sep**, **Next week · Mon 28 Sep**, **No date**, then a month calendar.
3. User picks Tomorrow (click, or press **M**). The task shows a date chip 'Tomorrow'.
4. Next day, user clicks 'Today' in the sidebar. The address changes to the workspace's Today address. The view shows 'Overdue' (if any) then 'Today', each task with its project name and colour, or 'Inbox'. The browser tab reads '(4) Today · My Todoodle'.

**Picker keyboard**: T = Today, M = Tomorrow, W = This weekend, N = Next week, 0 = No date; arrow keys move around the calendar, Enter picks, Escape closes without change. Focus returns to whatever opened the picker.

**Shortcut meanings**
- **Next week** = the next Monday. On a Monday it means the Monday a week later.
- **This weekend** = the coming Saturday. On a Saturday or a Sunday it means today, because the weekend is already underway.

**Date chip display**
- 'Today' (green), 'Tomorrow' (orange), weekday name for 2 to 6 days ahead, otherwise a short date (year shown only if it differs from this year).
- Overdue chips say 'Yesterday' or 'N days overdue', in red **with a warning icon**. Screen readers hear 'Overdue: due Tue 22 Sep'. Colour is never the only signal, and all chip colours stay readable in light and dark themes.

**Alternate flows**
- Nothing due: 'All clear for today' empty state.
- Reschedule on the Overdue group with **one** overdue task: moves it to today immediately (with Undo).
- Reschedule with **more than one** overdue task: a confirmation 'Move 7 overdue tasks to today?' with Move / Cancel, then the move (with Undo).
- The Undo toast lasts 10 seconds and stays open while the pointer is over it or it has keyboard focus; ⌘/Ctrl+Z also undoes.
- Clearing a date removes the chip and the task leaves Today.
- Completing a task from Today behaves as in story 6.
- Sidebar 'Today' entry shows the count of today and overdue open tasks; the tab title shows the same count (omitted when 0).
- Adding a task from Today dates it today and puts it in the Inbox. On phones the floating '+' button (story 5) does the same while Today is open.
- Reloading while on Today stays on Today.
- With thousands of tasks, Today stays responsive: typing in quick add is never held up by the list updating.

**Non-behaviours**
- No times of day, reminders, notifications, or recurring dates in MVP.
- No Upcoming (future) view in MVP.
- Today does not show completed tasks unless 'Show completed' is on.
- Pressing D, T, M, W, N or 0 while typing in a text field types the letter; it never opens or drives the picker.

## Set and clear a due date

> Anchor: `prd.set_due_date`

WHEN a user sets or clears a task's due date THE SYSTEM SHALL save it and update the task's date display for all users of the workspace.

## Today view

> Anchor: `prd.today_view`

WHEN a user opens Today THE SYSTEM SHALL show every open task in the workspace due on the viewer's current local date, across the Inbox and all projects.

## Overdue grouped first

> Anchor: `prd.overdue_group`

WHILE open tasks exist with a due date before the viewer's current local date THE SYSTEM SHALL show them in an Overdue group above today's tasks in the Today view.

## Dates are per-viewer local

> Anchor: `prd.local_dates`

THE SYSTEM SHALL treat due dates as calendar dates and SHALL determine 'today' and 'overdue' using each viewer's own local date.

## Reschedule overdue

> Anchor: `prd.reschedule_overdue`

WHEN a user chooses to reschedule overdue tasks THE SYSTEM SHALL set every overdue open task's due date to the viewer's current local date.

## Views roll over at midnight

> Anchor: `prd.midnight_rollover`

WHILE the Today view is open WHEN the viewer's local date changes THE SYSTEM SHALL recompute which tasks are today and overdue without a reload.

## Today count in sidebar

> Anchor: `prd.today_count`

THE SYSTEM SHALL show the number of open tasks due today or overdue next to Today in the sidebar.

## Adding a task from Today dates it today

> Anchor: `prd.today_quick_add_default`

WHEN a user adds a task with quick add while viewing Today THE SYSTEM SHALL save it to the Inbox with a due date of the viewer's current local date unless the user picked a different date.

## Today shows where each task lives

> Anchor: `prd.today_project_context`

WHILE the Today view is shown THE SYSTEM SHALL display each task's project name and colour, or 'Inbox' for tasks not in a project.

## Date labels are relative and colour-coded

> Anchor: `prd.date_chip`

THE SYSTEM SHALL label each dated task relative to the viewer's local date: 'Today' (green), 'Tomorrow' (orange), the weekday name for 2 to 6 days ahead, 'Yesterday' or 'N days overdue' in red with a warning icon when overdue, and otherwise a short date that includes the year only when it differs from the current year.

## Reschedule only moves what the user saw

> Anchor: `prd.reschedule_scope`

IF a task was not shown in the user's Overdue group when they chose Reschedule, or has since been completed, deleted, or given a date that is no longer overdue, THEN THE SYSTEM SHALL NOT change that task's due date.

## Undo reschedule

> Anchor: `prd.undo_reschedule`

WHEN a user chooses Undo within 10 seconds of rescheduling overdue tasks (the window pausing while the Undo notice is hovered or focused) THE SYSTEM SHALL restore each rescheduled task's previous due date, except tasks another person has changed since, which it SHALL leave unchanged and report to the user.

## Picker shortcuts show the dates they mean

> Anchor: `prd.picker_shortcuts`

WHEN the date picker opens THE SYSTEM SHALL offer Today, Tomorrow, This weekend, Next week and No date, each showing the calendar date it resolves to, where Next week is the next Monday and This weekend is the coming Saturday, or today when today is Saturday or Sunday.

## Picker works from the keyboard

> Anchor: `prd.picker_keyboard`

WHILE the date picker is open WHEN the user presses T, M, W, N or 0 THE SYSTEM SHALL choose Today, Tomorrow, This weekend, Next week or No date respectively, and arrow keys SHALL move between days in the calendar.

## D sets the selected task's date

> Anchor: `prd.date_shortcut_key`

WHEN a task is selected in a list and the user presses D while not typing in a text field THE SYSTEM SHALL open the date picker for that task.

## Overdue is never shown by colour alone

> Anchor: `prd.overdue_accessible`

THE SYSTEM SHALL convey that a task is overdue with words, a warning icon and a screen-reader label of the form 'Overdue: due <date>', and SHALL render all date-chip colours with at least WCAG AA contrast in light and dark themes.

## Confirm before moving several tasks

> Anchor: `prd.reschedule_confirm`

IF Reschedule would move more than one overdue task THEN THE SYSTEM SHALL NOT change any date until the user confirms a prompt stating how many tasks will move; with exactly one overdue task THE SYSTEM SHALL move it without a prompt.

## Tab title shows what's due

> Anchor: `prd.today_tab_title`

WHILE the Today view is open THE SYSTEM SHALL title the browser tab '(N) Today · <workspace name>', where N is the number of open tasks due today or overdue, omitting '(N) ' when N is 0, and SHALL NOT include the workspace link or its secret.

## Today has its own address

> Anchor: `prd.today_address`

WHEN a user opens Today THE SYSTEM SHALL change the page address to the workspace's Today address, so that reloading or using browser back and forward returns to Today.

## Large Today lists stay responsive

> Anchor: `prd.today_responsive`

WHILE the Today view shows up to 5,000 open tasks WHEN the user types in quick add or the list changes because of a reschedule or a collaborator's edit THE SYSTEM SHALL show each keystroke within 100 ms.

## Out of scope

- Due times, reminders, notifications
- Recurring tasks
- Natural-language date entry
- Upcoming/calendar views
- Priorities and sorting options

## Constraints

- Date picker fully keyboard-operable and screen-reader labelled.
- Today view loads in under 500 ms for a workspace with 5,000 open tasks.
- With 5,000 open tasks, typing in quick add on the Today view shows each keystroke without perceptible delay (under 100 ms).
- Chip and warning colours meet WCAG AA contrast (4.5:1 for text) in both light and dark themes.

