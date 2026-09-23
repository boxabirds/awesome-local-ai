# PRD

Each person can undo and redo their own recent changes on a shared board, one meaningful action at a time, without ever reversing anyone else's work.

## Problem

Mistakes on a board cannot be reversed today.

Pain points:
1. **Accidents are permanent** — an accidental Delete on a selection of 20 notes (story 7) destroys work with no way back.
2. **Fear slows people down** — without undo, participants hesitate to rearrange or experiment.
3. **Naive undo is destructive on shared boards** — stepping the whole board back in time would erase colleagues' work done in the meantime, which is worse than no undo.
4. **Too-fine undo is useless** — if every animation frame of a drag or every keystroke were a separate step, users would press undo dozens of times to reverse one action.
5. **Unclear availability** — users can't tell whether there is anything to undo.

## Solution

- **Accidents → personal undo.** Ctrl/Cmd+Z reverses the person's own last action; redo re-applies it.
- **Fear → safety net.** A generous history (200 steps) makes experimentation safe.
- **Destructive shared undo → per-person history.** Each person's history contains only their own changes; colleagues' work is never reversed.
- **Too-fine undo → meaningful steps.** A whole drag, resize, delete, colour change or burst of typing is one step.
- **Unclear availability → visible buttons.** Undo and Redo buttons in the toolbar are disabled when there is nothing to undo or redo.

## User Experience

### Golden path
1. Mia selects 8 notes and accidentally presses Delete.
2. She presses Ctrl/Cmd+Z. All 8 notes reappear with their text, colours, sizes and positions, on everyone's screen.
3. Meanwhile Raj added a note; it is still there.
4. Mia presses Ctrl/Cmd+Shift+Z: the 8 notes are deleted again. She presses Ctrl/Cmd+Z again to restore them.

### Structure
- Left toolbar, below the tools: Undo (curved arrow left) and Redo (curved arrow right) buttons with tooltips showing shortcuts.

### Behaviour
- Shortcuts: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo.
- One step each: a complete drag of a selection, a complete resize, one delete (of any number of objects), one colour change, one note creation, and one burst of typing (typing that continues without a pause of half a second or more, or until editing ends).
- While typing in a note, Ctrl/Cmd+Z undoes typing in that note; after leaving the note, undo continues through earlier actions.
- Making a new change after undoing clears redo.
- The history keeps the most recent 200 steps.
- Undo and Redo buttons are disabled when their history is empty.

### Alternate flows
- **Nothing to undo:** shortcut does nothing; button disabled.
- **Undoing a move of a note someone else has since deleted:** nothing visible happens, no error; the next undo continues normally.
- **Undoing my delete of a note while someone else was editing it:** the note comes back with its content at the time of my delete.
- **Board failed to load (story 4):** undo and redo are unavailable (buttons disabled).
- **Page reloaded:** history starts empty.

### Explicit non-behaviours
- Does not undo other people's changes.
- Does not keep history after reload or on another device.
- Does not provide version history or a visual history list.
- Does not undo board navigation (pan/zoom) or selection changes.

## Undo only my own changes

> Anchor: `undo.own`

WHEN a user undoes THE SYSTEM SHALL reverse that user's most recent change, and IF other people changed the board since THEN THE SYSTEM SHALL NOT reverse any of their changes.

Verification: Mia moves note A; Raj then creates note B and recolours note C; Mia undoes → A returns to its old position, B still exists and C keeps Raj's colour.

## Redo

> Anchor: `undo.redo`

WHEN a user redoes THE SYSTEM SHALL re-apply that user's most recently undone change.

## New change clears redo

> Anchor: `undo.redo_cleared`

WHEN a user makes a new change after undoing THE SYSTEM SHALL discard that user's redo history.

## Meaningful undo steps

> Anchor: `undo.steps`

THE SYSTEM SHALL treat each complete drag, complete resize, delete action, colour change and object creation as exactly one undo step, regardless of how many intermediate updates it produced.

Verification: drag a selection of 5 notes across the board in one gesture; a single undo returns all 5 to their starting positions.

## Typing bursts

> Anchor: `undo.typing`

WHILE a user is editing text THE SYSTEM SHALL group consecutive typing without a pause of 500 milliseconds or more into one undo step, and WHEN the user presses Ctrl/Cmd+Z while editing THE SYSTEM SHALL undo the most recent typing step in that text.

## Keyboard shortcuts

> Anchor: `undo.shortcuts`

WHEN a user presses Ctrl/Cmd+Z THE SYSTEM SHALL undo, and WHEN the user presses Ctrl/Cmd+Shift+Z or Ctrl+Y THE SYSTEM SHALL redo, without triggering the browser's own undo or other page actions.

## Undo and Redo buttons

> Anchor: `undo.buttons`

WHEN a user clicks the Undo or Redo button THE SYSTEM SHALL undo or redo, and WHILE the matching history is empty THE SYSTEM SHALL show that button as disabled.

## Undo never breaks on changed objects

> Anchor: `undo.safe`

IF the object affected by an undo step was deleted by another person THEN THE SYSTEM SHALL NOT show an error, SHALL NOT recreate content the user did not delete, and SHALL keep the rest of the history usable.

## History length

> Anchor: `undo.limit`

WHILE a user's history holds 200 steps THE SYSTEM SHALL discard the oldest step when a new step is added.

## History does not survive reload

> Anchor: `undo.session_only`

IF a user reloads the page THEN THE SYSTEM SHALL NOT offer to undo changes made before the reload.

## Unavailable when the board cannot be edited

> Anchor: `undo.not_editable`

WHILE the board cannot be edited because it failed to load THE SYSTEM SHALL disable undo and redo.

## Constraints

- **Collaboration:** up to 5 simultaneous editors (the configured capacity) can each undo and redo independently; all screens stay identical.
- **Settings:** history length (200) and typing pause (500 ms) are named product settings.
- **Future types:** text, shapes, connectors, drawings, images (stories 9–12) and comments (story 16) must be covered by the same history without new undo code.
- **Accessibility:** buttons have accessible names "Undo" and "Redo" and expose disabled state.

## Out of scope

- Undoing other people's changes; global board undo.
- Persistent or cross-device history; version history.
- Undo of pan/zoom or selection.
- A history list UI.

