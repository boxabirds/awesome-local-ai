# PRD

Create, rename, colour, and delete projects; move tasks into them.

## Problem

Once a list passes a couple of dozen items, a single Inbox becomes noise. People need to separate 'Work', 'Home', 'Trip to Lisbon' so they can focus on one area at a time.

## Solution

Users create named projects from the sidebar, each with a colour for quick recognition. Viewing a project shows only its tasks, and quick add in a project adds there. Tasks can be moved between the Inbox and projects. Projects can be renamed and deleted; deleting a project with tasks requires explicit confirmation and can be undone.

## User Experience

**Golden path**
1. In the sidebar under 'Projects', user clicks '+'.
2. A small dialog: Name (required), Colour (palette of 12, first colour preselected, each swatch named for screen readers). 'Add' creates it; Enter in the name field also submits.
3. The new project appears at the bottom of the sidebar's project list with its colour dot and open-task count (0), and opens in the main area (empty).
4. User adds tasks via quick add; they land in this project.
5. To move a task, the user chooses 'Move to…' from the task's '…' menu, or presses M while the task is focused. A small search box opens listing Inbox first, then every project with its colour dot; the task's current list is marked with a check and cannot be chosen. Typing filters the list as you type ('wo' shows 'Work' and 'Woodwork'). Enter or a click moves the task; it leaves the current view, sidebar counts update, and keyboard focus moves to the next task. Escape closes the box and returns focus to the task.

**Structure**
- Sidebar order: Inbox, Today, then a 'Projects' heading with a '+' button and the projects in creation order.
- Each project row: colour dot, name (truncated with full name on hover), open-task count (hidden when 0), and a '…' menu (Rename, Delete). With a mouse the '…' button appears on hover or keyboard focus; on touch screens it is always visible, because hover does not exist there.
- Colour is never the only way to tell projects apart: the name is always shown next to the dot, and every colour is clearly visible against both the light and the dark theme.
- The main area header shows the project name and colour dot for the project being viewed.
- The address bar changes when switching between Inbox and projects, so a project can be bookmarked and reopened directly (the saved link still works).

**Phones and small screens**
- The sidebar (Inbox, Today, Projects) lives in a slide-in drawer opened from the ☰ button; choosing a project closes the drawer and shows the project.
- Every tappable control in the Projects section (rows, '+', '…', colour swatches, Move-to entries) is at least a comfortable finger size.
- The Move-to search box is the same on phones, shown as a panel from the bottom of the screen.

**Alternate flows**
- Empty project: 'No tasks yet. Press Q to add one.'
- No projects: sidebar shows 'Projects' heading with only the '+' and hint 'Group tasks by area'.
- Rename: '…' menu on the project > Rename; inline edit; Enter saves, Escape cancels. If the field is left empty, the old name comes back and a short note 'Name can't be empty' appears under the field.
- Project name longer than the limit: nothing is cut off; a counter shows how many characters are over and Add/Save stays disabled until it fits.
- Move-to search finds nothing: 'No matching projects' is shown; Escape clears or closes.
- Delete project with no tasks: 'Delete "Work"?' confirm, then removed, toast with Undo.
- Delete project with tasks: 'Delete "Work" and its 12 tasks?' (count includes completed tasks that will also be removed). Confirmation is kept here because this removes many tasks at once. Confirm → project and tasks gone; the Undo toast stays for 10 seconds and does not disappear while the pointer or keyboard focus is on it. Undo restores both. Tasks that had already been deleted on their own before the project was deleted stay deleted.
- Deleting the project currently being viewed takes the user to the Inbox.
- A collaborator deletes the project another user is viewing: that viewer is taken to the Inbox with a notice 'This project was deleted'.
- Workspace already holds the maximum number of projects: '+' dialog shows 'You've reached the limit of 300 projects' and Add is disabled.
- Save fails (create/rename/delete/move): the change is rolled back on screen and a 'Couldn't save — try again' toast appears.
- Duplicate names are allowed (Todoist allows them).

**Non-behaviours**
- No nested sub-projects, sections, archiving, favourites, reordering, or board layout in MVP.
- No drag-and-drop moving of tasks in MVP (Move to… and M cover it).
- Inbox is not a project in the list and cannot be renamed/deleted.
- Moving a task does not change its due date, completion state, or name.

## Create project

> Anchor: `prd.create_project`

WHEN a user creates a project with a non-empty name THE SYSTEM SHALL add it to the workspace's project list with the chosen colour.

## View a project

> Anchor: `prd.view_project`

WHEN a user selects a project THE SYSTEM SHALL show only that project's tasks.

## Move tasks between lists

> Anchor: `prd.move_task`

WHEN a user moves a task to the Inbox or another project THE SYSTEM SHALL show the task only in the destination list.

## Rename project

> Anchor: `prd.rename_project`

WHEN a user renames a project to a non-empty name THE SYSTEM SHALL save and display the new name.

## Delete project with its tasks

> Anchor: `prd.delete_project`

WHEN a user confirms deletion of a project THE SYSTEM SHALL remove the project and all of its tasks from every view.

## Deletion warns about contained tasks

> Anchor: `prd.delete_project_warning`

IF a project being deleted contains tasks THEN THE SYSTEM SHALL state how many tasks will be deleted before asking for confirmation.

## Undo project deletion

> Anchor: `prd.undo_project_delete`

WHEN a user chooses Undo within 10 seconds of deleting a project THE SYSTEM SHALL restore the project and all tasks deleted with it. (Window raised from 5 to 10 seconds by product-owner decision on 2026-09-25; the offer stays visible while the pointer or keyboard focus rests on it.)

## Sidebar shows open-task counts

> Anchor: `prd.project_counts`

THE SYSTEM SHALL show the number of open tasks next to the Inbox and each project in the sidebar.

## Project limit is enforced and explained

> Anchor: `prd.project_limit`

IF a workspace already contains the maximum number of projects (300) THEN THE SYSTEM SHALL NOT create another project and SHALL tell the user the limit has been reached.

## Viewing a project someone else deletes

> Anchor: `prd.viewed_project_deleted`

WHILE a user is viewing a project WHEN that project is deleted by anyone THE SYSTEM SHALL take that user to the Inbox and tell them the project was deleted.

## Undo restores only what the deletion removed

> Anchor: `prd.undo_restores_exact_set`

IF a task was deleted on its own before its project was deleted THEN THE SYSTEM SHALL NOT restore that task when the project deletion is undone.

## Quick add inside a project adds to it

> Anchor: `prd.quick_add_in_project`

WHILE a user is viewing a project WHEN they add a task with quick add THE SYSTEM SHALL add the task to that project.

## Move to… can be searched

> Anchor: `prd.move_search`

WHEN a user types in the Move to… box THE SYSTEM SHALL show only the Inbox and projects whose names contain the typed text, ignoring letter case and accents, with the task's current list marked and not selectable.

## M opens Move to… for the focused task

> Anchor: `prd.move_shortcut`

WHEN a user presses M while a task is focused and they are not typing in a field THE SYSTEM SHALL open Move to… for that task, and after the move or on Escape SHALL return keyboard focus to the task list.

## Project controls work on touch screens

> Anchor: `prd.touch_controls`

WHILE the device has no hover capability THE SYSTEM SHALL show each project's '…' menu button without requiring hover, and SHALL give every project control a touch target of at least 44 by 44 pixels.

## Blank project names explain themselves

> Anchor: `prd.blank_name_hint`

IF a user leaves a project name empty when renaming THEN THE SYSTEM SHALL NOT save it, SHALL restore the previous name, and SHALL show the note 'Name can't be empty'.

## Project colours are legible and never the only cue

> Anchor: `prd.colour_legible`

THE SYSTEM SHALL show every project's name alongside its colour, and SHALL render every project colour with at least 3:1 contrast against the background in both light and dark themes.

## Over-long names are never silently cut

> Anchor: `prd.name_over_limit`

IF a project name typed or pasted exceeds the length limit THEN THE SYSTEM SHALL NOT shorten it, SHALL show how many characters are over, and SHALL keep Add or Save disabled until the name fits.

## Out of scope

- Sub-projects, sections, board view, archiving, favourites, project reordering
- Project templates or import
- Drag-and-drop moving of tasks between lists

## Constraints

- Project name limit 120 characters; text over the limit is never cut off silently.
- Up to 300 projects per workspace must remain responsive, including filtering in Move to….
- Works on phones and tablets as well as desktop; touch controls at least 44 by 44 pixels.
- Colour swatches and dots meet WCAG 2.2 AA non-text contrast (at least 3:1) against both light and dark backgrounds; colour never carries meaning on its own.
- Every action is usable with keyboard alone and announced sensibly by screen readers.

