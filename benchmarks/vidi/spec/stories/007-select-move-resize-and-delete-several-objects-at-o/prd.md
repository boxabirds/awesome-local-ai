# PRD

Users select several objects (shift-click, Shift+drag box, select all), then move, resize, nudge and delete them together, with one consistent set of handles for every kind of board object.

## Problem

After story 2, people can only act on one sticky note at a time, and notes have a fixed size.

Pain points:
1. **Reorganising is slow** — moving a cluster of 12 notes to another area means 12 separate drags, and the cluster's layout gets disturbed on the way.
2. **Cleaning up is slow** — removing a finished section of a board means deleting notes one by one.
3. **No emphasis** — every note is the same size, so a headline idea cannot be made bigger than its details.
4. **Imprecise placement** — lining things up by dragging with a mouse is fiddly; there is no fine adjustment.
5. **Inconsistency ahead** — text, shapes, drawings and images are coming (stories 9–12). If each kind of object had its own way of being selected, moved and resized, the board would feel incoherent and every new kind of object would repeat the same work.

## Solution

- **Slow reorganising → multi-select and group move.** Shift-click to add objects, Shift+drag a box around a region, or select everything; drag any selected object and the whole selection moves together, keeping its layout.
- **Slow clean-up → group delete.** Delete or Backspace removes everything selected at once; a toolbar button does the same.
- **No emphasis → resizing.** Drag handles on the selection to make objects bigger or smaller. Sticky notes stay square.
- **Imprecise placement → arrow-key nudging.** Arrow keys move the selection by a small step; Shift+arrow by a larger step.
- **Inconsistency → one behaviour for all objects.** Selection outline, handles, moving, resizing and deleting work identically for every kind of object added in later stories.

## User Experience

### Golden path
1. Lee has a board with 20 sticky notes. Lee holds Shift and drags a box across empty board space around 6 notes. A light blue translucent rectangle follows the pointer.
2. On release, the 6 notes fully inside the box are selected: each shows a thin outline, and one blue bounding box surrounds all of them with 8 square handles (4 corners, 4 edges). A small bar above the box reads "6 selected" with a delete (bin) button.
3. Lee Shift-clicks a 7th note outside the box; it joins the selection and the bounding box grows. Lee Shift-clicks one of the 6 again; it leaves the selection.
4. Lee drags any selected note; all 6 move together, keeping their arrangement, and appear above other notes.
5. Lee drags the bottom-right corner handle outward; all 6 notes grow and spread out proportionally from the opposite corner.
6. Lee presses the Right arrow three times; the selection moves right in small steps. Shift+Right moves it further.
7. Lee presses Delete; all 6 disappear.

### Structure
- Selection outline on each selected object.
- Bounding box around the whole selection with 8 resize handles (handles stay the same size on screen at any zoom).
- Selection bar above the bounding box: "N selected" and a Delete button. When exactly one sticky note is selected, story 2's note toolbar (colours + delete) appears instead.
- Shift+drag selection rectangle (light blue, translucent).

### Behaviour
- Click an object: selects only that object. Shift-click: adds or removes it.
- Shift+drag starting on empty space: selection rectangle; objects entirely inside are added to the selection.
- Plain drag on empty space still moves the board (story 1).
- Ctrl/Cmd+A selects every object on the board (unless typing in a note).
- Escape or click on empty space clears the selection.
- Dragging a selected object moves the whole selection. Dragging an unselected object selects just it and moves it.
- Corner handles resize in both directions; edge handles resize in one direction. Sticky notes always stay square. Holding Shift while dragging any handle keeps the selection's proportions.
- Objects cannot be made smaller than a minimum size (sticky notes: 50 board units) or larger than a maximum (20,000 board units).
- Arrow keys nudge by 1 board unit; Shift+arrow by 10.
- If someone else deletes an object I have selected, it simply drops out of my selection; the rest stay selected.
- Other people see the objects move, resize and disappear live (story 3); they do not see my selection.

### Alternate flows
- **Empty board:** Ctrl/Cmd+A selects nothing and nothing happens; Shift+drag draws a rectangle that selects nothing.
- **Selection rectangle touching but not enclosing an object:** that object is not selected.
- **Pressing Delete while typing inside a note:** deletes a character, not the selection.
- **Board failed to load (story 4):** selection works for viewing, but move, resize, nudge and delete are unavailable.
- **Two people move the same object at once:** both see the object settle in the same place (story 3).

### Explicit non-behaviours
- Does not rotate objects.
- Does not group objects permanently (selection is temporary).
- Does not copy, paste or duplicate.
- Does not align or distribute objects automatically, and does not snap to guides.
- Does not show other people's selections (story 6 may add presence cues).
- Does not undo (story 8).

## Click selects one object

> Anchor: `sel.click`

WHEN a user clicks an object without holding Shift THE SYSTEM SHALL make that object the only selected object.

## Shift-click adds or removes

> Anchor: `sel.shift_toggle`

WHEN a user Shift-clicks an object THE SYSTEM SHALL add it to the selection if it was not selected, or remove it from the selection if it was selected, leaving other selected objects unchanged.

## Select with a box

> Anchor: `sel.marquee`

WHEN a user holds Shift and drags from empty board space THE SYSTEM SHALL show a selection rectangle and, on release, add every object lying entirely inside the rectangle to the selection.

IF an object is only partly inside the rectangle THEN THE SYSTEM SHALL NOT select it.

Verification: with notes A (fully inside), B (half inside) and C (outside), Shift+drag selects only A.

## Select all

> Anchor: `sel.all`

WHEN a user presses Ctrl/Cmd+A while not editing text THE SYSTEM SHALL select every object on the board and SHALL NOT select the page's text.

## Clear selection

> Anchor: `sel.clear`

WHEN a user presses Escape while not editing text, or clicks empty board space without dragging, THE SYSTEM SHALL clear the selection.

## Move the selection together

> Anchor: `sel.group_move`

WHEN a user drags any selected object THE SYSTEM SHALL move every selected object by the same distance, keeping their relative positions, and show them above unselected objects while keeping their stacking order among themselves.

Verification: select 3 overlapping notes, drag one by 300 board units; all 3 move 300 units, their overlap order is unchanged, and they are above a 4th note they are dragged over.

## Dragging an unselected object

> Anchor: `sel.drag_unselected`

WHEN a user drags an object that is not selected THE SYSTEM SHALL select only that object and move only that object.

## Resize with handles

> Anchor: `sel.resize`

WHEN a user drags a handle of the selection's bounding box THE SYSTEM SHALL resize the selection from the opposite corner or edge, scaling each selected object's size and position proportionally.

Verification: two notes of 200 units, 100 units apart, resized by dragging the right edge until the box is twice as wide: each note is 400 units wide (sticky notes stay square, so also 400 tall) and the gap is 200 units.

## Proportions kept when required

> Anchor: `sel.aspect`

WHILE a user resizes a selection containing a sticky note, or holds Shift during any resize, THE SYSTEM SHALL keep the width-to-height ratio of the bounding box unchanged.

## Size limits

> Anchor: `sel.size_limits`

IF a resize would make any selected object smaller than its minimum size (50 board units for sticky notes) or larger than 20,000 board units THEN THE SYSTEM SHALL NOT resize past that limit and SHALL stop the whole selection at the scale where the first object reaches it.

## Nudge with arrow keys

> Anchor: `sel.nudge`

WHEN a user presses an arrow key while objects are selected and no text is being edited THE SYSTEM SHALL move the selection 1 board unit in that direction, or 10 board units if Shift is held, and SHALL NOT scroll the page or pan the board.

## Delete the selection

> Anchor: `sel.group_delete`

WHEN a user presses Delete or Backspace while objects are selected and no text is being edited, or clicks Delete on the selection bar, THE SYSTEM SHALL remove every selected object and clear the selection.

## Selection bar

> Anchor: `sel.bar`

WHILE two or more objects are selected THE SYSTEM SHALL show a bar above the selection reading "N selected" with a Delete button, and WHILE exactly one sticky note is selected THE SYSTEM SHALL show the sticky note toolbar instead.

## Objects deleted by others leave my selection

> Anchor: `sel.remote_delete`

WHEN an object in a user's selection is deleted by another person THE SYSTEM SHALL remove it from that user's selection and keep the remaining objects selected.

## Same behaviour for every object type

> Anchor: `sel.all_types`

THE SYSTEM SHALL apply the same selection, move, resize, nudge and delete behaviour to every type of board object, with each type able to declare only whether it can be resized, whether it keeps its proportions, and its minimum size.

## Constraints

- **Performance:** moving or resizing a selection of 200 notes follows the pointer without visible lag on a mid-range laptop (scripted check, not a CI gate).
- **Collaboration:** moves and resizes are shared live as in story 3, including when up to the configured number of simultaneous editors (5) move different selections at once; the result must be identical on every screen.
- **Settings:** handle size, nudge steps and size limits are named product settings.
- **Accessibility:** "N selected" is announced to screen readers when the selection changes; handles have accessible names (e.g. "Resize top-left").
- **Compatibility:** sticky notes created before this story (fixed size) keep their current size and become resizable.

## Out of scope

- Rotation, flipping.
- Permanent groups, locking objects.
- Copy, paste, duplicate.
- Alignment, distribution, snapping, smart guides.
- Showing other people's selections.
- Undo/redo (story 8).
- Touch gestures.

