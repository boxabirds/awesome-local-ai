# PRD

Complete, reopen, edit and delete tasks — deletion is instant with a 10-second Undo (no confirmation), everything works by keyboard and touch, and outcomes are announced.

## Problem

A task list is only useful if you can tick things off, fix typos, and remove junk. Because any collaborator with the link has full access, accidental completion or deletion is more likely and more costly — there is no admin to restore things. At the same time, extra 'Are you sure?' steps on every small action slow people down and train them to click through warnings without reading. Keyboard, screen-reader and phone users are easily stranded if focus jumps around or actions hide behind mouse hover.

## Solution

Users tick a checkbox to complete a task; the tick shows instantly, the task leaves the list after a brief animation, and an Undo toast appears. They can view completed tasks and reopen them. Clicking a task opens its detail to edit name and description. Deleting is instant — no confirmation — and always offers Undo. Undo stays available for 10 seconds, longer while the user is pointing at or focused on it, and Cmd/Ctrl+Z undoes the latest action. Everything works from the keyboard, focus lands somewhere sensible after every action, outcomes are announced to assistive technology, and on a phone the task detail fills the screen and every action is reachable by touch. Nothing a user does is irreversible within the undo window.

Owner decisions (approved 2026-09-25): single-task delete has no confirmation dialog (Undo is the safeguard); the undo window is 10 seconds instead of 5.

## User Experience

**Golden path — complete**
1. User clicks a task's round checkbox. It shows a tick immediately; after a short (about a quarter-second) animation the task leaves the open list. With reduced motion turned on, it leaves immediately. The list counts in the sidebar change at the same moment.
2. A toast 'Task completed · Undo' appears for 10 seconds. It stays while the pointer is over it or keyboard focus is in it. Screen readers hear 'Task completed' without being interrupted.
3. Keyboard focus moves to the next task in the list (or the previous one if the completed task was last), never back to the top of the page.

**Golden path — edit**
1. User clicks a task name, or presses Enter on it. A detail panel opens on the right (full screen on phones and narrow windows) with editable name and description; the name is focused. The same panel opens from search results (story 11), where there is no row to return to.
2. Name saves on Enter or when the field loses focus; description saves when it loses focus. Escape cancels the in-progress edit; a second Escape closes the panel.
3. Closing the panel returns focus to the task it was opened from, or to whatever opened it (for example a search result).

**Golden path — delete**
1. From the task's '…' menu, the detail panel, or the Delete key, user deletes the task.
2. It disappears at once, with no 'Are you sure?' step, and a toast 'Task deleted · Undo' appears for 10 seconds (kept while hovered or focused). Counts update at once.
3. Focus moves to the next task (or previous if it was last). If deleted from the detail panel, the panel closes and focus goes to that next task.

**Undo**
- Clicking Undo, or pressing Cmd+Z (Mac) / Ctrl+Z (others) while an undo toast is visible, the user is not typing in a text field and no dialog, panel, picker or search overlay is open, restores the most recent completed or deleted task exactly where it was. Inside a text field, Cmd/Ctrl+Z keeps its normal text-undo meaning.
- If Undo itself fails: 'Couldn't undo — try again' is shown and announced immediately.

**Offline** (the shared offline state comes from story 4)
- The task list, the 'Show completed' toggle and opening a task's detail panel keep working. The panel opens read-only: its fields and Delete button are disabled, so nothing typed can be lost.
- Completing, reopening, editing, deleting and Undo are disabled. Checkbox, '…' menu actions and keyboard shortcuts do nothing while offline; the Undo button in an open toast is disabled.

**Alternate flows**
- A 'Show completed' toggle in the list's header (next to the list title) reveals completed tasks in a separate 'Completed' group below the open tasks, struck through with their completion date; the current list stays on screen while completed tasks load (no flash). Clicking a completed task's checkbox reopens it. The toggle is remembered per list on this browser.
- Editing a name to empty: the previous name comes back and 'Name can't be empty' shows briefly under the field.
- A change fails to save: the task returns to its prior state and 'Couldn't save — try again' is shown and announced immediately. While a change is saving, the task is marked busy to assistive technology.
- Someone else changes or deletes the task while its panel is open: handled by the shared notice from story 4 ('Someone else changed this task just now.' with a choice to keep your version, or 'This task was deleted').
- Deleting the only task in a list: focus moves to the list's '+ Add task' control.

**Structure**
- Each task row: round checkbox (tap area at least 44×44 px), name, muted description preview, and a '…' menu (Edit · E, Delete · Del). The menu button is always visible on touch devices and appears on hover or focus with a mouse.
- A screen reader announces the checkbox by the task's name, with 'Complete' or 'Reopen' as its description, and its checked state.
- The '…' menu shows each action's keyboard shortcut.

**Keyboard** (moving between tasks with ↑/↓ and between the checkbox, name and '…' with ←/→ comes from story 5): with a task focused and not typing in a field:
- Enter on the task name opens its detail panel.
- E opens the detail panel from anywhere in the row.
- Space completes (or reopens) and Delete/Backspace deletes with Undo, when focus is on the checkbox or the name. On the '…' button, Space presses that button instead.
- Cmd/Ctrl+Z undoes the most recent action.
All appear in the '?' shortcuts panel.

**Non-behaviours**
- No confirmation for deleting a single task; deleting a project still asks (story 7).
- No permanent 'empty trash'; deleted tasks are not visible to users after the undo window but are retained internally.
- No bulk operations and no swipe gestures in MVP.

## Complete a task

> Anchor: `prd.complete`

WHEN a user completes an open task THE SYSTEM SHALL mark it completed with the completion time and remove it from open task lists.

## Completion is visibly acknowledged

> Anchor: `prd.complete_feedback`

WHEN a user completes a task THE SYSTEM SHALL show the checkbox as ticked immediately and SHALL remove the task from the open list after a brief animation, or immediately WHERE the user has requested reduced motion.

## Counts follow task changes at once

> Anchor: `prd.counts_follow`

WHEN a user completes, reopens, deletes or restores a task THE SYSTEM SHALL update the affected list counts at the same moment the task changes on screen, and SHALL return them to their prior values if the change fails to save.

## Reopen a completed task

> Anchor: `prd.reopen`

WHEN a user reopens a completed task THE SYSTEM SHALL return it to its original list position as an open task.

## View completed tasks

> Anchor: `prd.show_completed`

WHILE 'show completed' is on THE SYSTEM SHALL display completed tasks in the current list as a separate 'Completed' group below the open tasks, visually distinguished from open tasks.

The 'Show completed' toggle sits in the list's header and remains usable while the workspace is offline.

## Show-completed choice is remembered

> Anchor: `prd.remember_show_completed`

WHEN a user turns 'show completed' on or off for a list THE SYSTEM SHALL remember that choice for that list on this browser and apply it the next time the list is opened.

## Edit task name and description

> Anchor: `prd.edit`

WHEN a user saves a change to a task's name or description THE SYSTEM SHALL persist it and show it to all users of the workspace.

## Name cannot be blanked

> Anchor: `prd.edit_blank_name`

IF a user saves an empty task name THEN THE SYSTEM SHALL keep the previous name and briefly show that the name can't be empty.

## Delete immediately, with Undo instead of confirmation

> Anchor: `prd.delete`

WHEN a user deletes a task THE SYSTEM SHALL remove it from all views immediately, without asking for confirmation, and SHALL offer Undo.

## Undo completion and deletion

> Anchor: `prd.undo`

WHEN a user chooses Undo within 10 seconds of completing or deleting a task THE SYSTEM SHALL restore the task to its prior state and position.

## Undo waits while the user is attending to it

> Anchor: `prd.undo_pause`

WHILE the pointer is over an undo toast or keyboard focus is inside it THE SYSTEM SHALL keep the toast and its Undo action available.

## Undo from the keyboard

> Anchor: `prd.undo_shortcut`

WHILE an undo toast is visible, the workspace is online, no dialog, panel, picker or search overlay is open and the user is not typing in a text field WHEN the user presses Cmd+Z on Mac or Ctrl+Z on other platforms THE SYSTEM SHALL undo the most recent completion or deletion.

## Deleted data is retained internally

> Anchor: `prd.retain_deleted`

THE SYSTEM SHALL retain deleted tasks internally so they can be recovered by the operator.

## Failed actions return the task to its prior state

> Anchor: `prd.failed_action_rollback`

IF completing, reopening, editing, deleting, or undoing a task fails to save THEN THE SYSTEM SHALL return the task to its prior state on screen and tell the user the change was not saved.

## Task actions work from the keyboard

> Anchor: `prd.keyboard_actions`

WHILE a task is focused, the workspace is online and the user is not typing in a text field WHEN the user presses E from anywhere in the task's row, Enter on the task's name, or Delete or Space while focus is on the task's checkbox or name THE SYSTEM SHALL respectively open the task for editing, open the task for editing, delete the task with Undo offered, or complete (or reopen) the task.

Space on a button in the row's actions area presses that button instead. Opening the task (E or Enter) also works offline, read-only (prd.offline_task_actions).

## Focus lands on the next task after an action

> Anchor: `prd.focus_after_action`

WHEN a focused or opened task leaves the current list because it was completed or deleted THE SYSTEM SHALL move keyboard focus to the next task in the list, or to the previous task if it was the last, or to the list's add-task control if the list is now empty.

## Closing the detail panel returns focus

> Anchor: `prd.focus_return`

WHEN the task detail panel closes THE SYSTEM SHALL return keyboard focus to the control that opened it (the task's row, or a search result), or to the task's row if that opener no longer exists but the task is still in the list.

## Task detail and actions work on small touch screens

> Anchor: `prd.mobile_detail`

WHILE the window is narrower than a tablet THE SYSTEM SHALL present the task detail panel full screen and SHALL make every task action reachable by touch without hovering.

## Outcomes are announced to assistive technology

> Anchor: `prd.action_announcements`

WHEN a task is completed, deleted, restored, or a change fails to save THE SYSTEM SHALL announce the outcome to assistive technology, politely for successes and immediately for failures, and SHALL mark a task as busy while its change is saving.

## Offline: read-only detail, no task changes

> Anchor: `prd.offline_task_actions`

WHILE the workspace is offline THE SYSTEM SHALL let the user open a task's detail panel read-only and turn 'show completed' on or off, and SHALL disable completing, reopening, editing, deleting and undoing tasks, including by keyboard shortcut.

Typed text is never discarded: the panel's fields are disabled rather than cleared. Online/offline state is defined by story 4.

## Out of scope

- User-facing trash/restore after the undo window
- Bulk select/complete/delete
- Moving tasks between projects (owned by story 7)
- Task history
- Swipe gestures on touch devices
- Undo history beyond the most recent visible undo toast

## Constraints

- All actions reflected on screen in under 100 ms (optimistic), with rollback on failure. List counts change in the same moment.
- Same limits as story 5 for name/description length.
- Honour the operating system's reduced-motion setting.
- Meet WCAG 2.2 AA: status messages announced, touch targets at least 44×44 px, time-limited undo can be extended by hovering or focusing.
- The completion checkbox is a real checkbox named by its task, so screen readers announce "<task name>, checkbox, checked/not checked" with Complete or Reopen as its description. The task list is story 5's keyboard grid; this story fills its checkbox and actions cells and its Completed group.
- Offline behaviour follows the shared offline rules (cross-story decision D-10): viewing, the 'Show completed' toggle and the read-only detail panel keep working; every change and Undo are disabled.
- No additional date library in the main page load; completion dates use the browser's built-in date formatting.

