# PRD

Users can create sticky notes, type on them, move, recolour and delete them on the infinite board.

## Problem

An empty board you can navigate (story 1) does nothing on its own. The most basic act on a whiteboard is jotting an idea down and moving it next to related ideas — the core of brainstorming, affinity mapping and retrospectives.

Pain points:
1. **Nowhere to capture an idea** — there is no way to put anything on the board.
2. **Ideas need regrouping** — thinking evolves; an idea placed once must be easy to move next to others.
3. **Categories need to be visible** — teams use colour to separate themes, owners or votes.
4. **Clutter** — wrong or duplicate notes must be easy to remove.
5. **Text must stay readable** — long text spilling out of a note or becoming unreadable defeats the purpose.

## Solution

Users work with sticky notes the way they would with paper ones.

- **Nowhere to capture → fast creation.** Double-click anywhere on empty board space, or use the Sticky note button, and start typing immediately.
- **Regrouping → drag to move.** Drag a note anywhere; the note under the pointer comes to the front.
- **Visible categories → colours.** Pick one of six colours for a selected note.
- **Clutter → delete.** Press Delete/Backspace on a selected note, or use the delete button on its toolbar.
- **Readable text → auto-fit.** Text shrinks to fit inside the note, down to a readable minimum size.

## User Experience

### Golden path
1. User double-clicks empty board space. A yellow square note appears centred on that spot with a blinking text cursor.
2. User types "Faster onboarding". Text appears in the note at a large size.
3. User clicks empty board space. Editing ends; the note keeps its text and is no longer selected.
4. User clicks the note. A blue outline appears around it and a small floating toolbar appears above it with six colour swatches and a delete (bin) button.
5. User clicks the green swatch. The note turns green.
6. User drags the note next to another note. It follows the pointer and appears on top of anything it overlaps.
7. User selects a duplicate note and presses Delete. It disappears.

### Structure
- Left-side vertical toolbar with a "Sticky note" button (tooltip: "Sticky note – or double-click the board").
- Sticky note: square, soft shadow, colour fill, text centred.
- Selection: blue outline around the selected note.
- Floating note toolbar (only for the selected note, not while dragging): six colour swatches (yellow, orange, green, blue, pink, violet) and a delete button.
- While editing: text cursor inside the note; a small character counter appears only when the note is within 50 characters of the 1,000 character limit.

### Behaviour
- New notes are yellow, 200 × 200 board units, and appear on top of all other notes.
- Toolbar button creates a note at the centre of the visible board area.
- Double-click on a note, or press Enter while a note is selected, starts editing with the cursor at the end of the text.
- Enter inside a note adds a new line. Escape or clicking outside ends editing.
- A short press without movement selects a note; moving more than a few pixels starts a drag. Dragging a note never pans the board.
- Notes scale with board zoom like everything else on the board.
- Text shrinks as it grows; once the minimum size is reached, further text is still kept but the overflowing part is hidden and the bottom edge of the note shows a fade.
- Delete/Backspace deletes the selected note only when not editing text; while editing they delete characters.
- Clicking empty board space clears the selection.

### Alternate flows
- **Empty state:** board with no notes shows story 1's hint; the Sticky note button is always available.
- **Empty note:** a note whose text is empty stays on the board (like a blank paper note) and shows no placeholder when not editing.
- **Pasting long text:** pasted text is cut off at the 1,000 character limit; the counter shows 1000/1000.
- **Drag interrupted** (pointer released outside window, system interruption): the note stays where it was last shown.
- **Error states:** notes exist only in the user's current page in this story, so there are no network errors. Reloading the page loses notes — made durable in story 4 and shared in story 3.

### Explicit non-behaviours
- Does not save notes across reload (story 4).
- Does not show notes to other people (story 3).
- Does not resize notes or select several at once (story 7).
- Does not support undo (story 8).
- Does not support rich text (bold, lists, links) or emoji pickers.
- Does not snap notes to a grid or to each other.

## Create by double-click

> Anchor: `sticky.create_dblclick`

WHEN a user double-clicks empty board space THE SYSTEM SHALL create a yellow sticky note centred on that point, on top of all other notes, with text editing active.

Verification: double-click at a point; a yellow note appears centred there and typed characters appear in it without further clicks.

## Create from toolbar

> Anchor: `sticky.create_button`

WHEN a user clicks the Sticky note toolbar button THE SYSTEM SHALL create a yellow sticky note centred in the visible board area, on top of all other notes, with text editing active.

Verification: pan anywhere, click the button; the new note is in the middle of the screen and accepts typing.

## Start editing text

> Anchor: `sticky.edit_start`

WHEN a user double-clicks a sticky note, or presses Enter while a sticky note is selected and not being edited, THE SYSTEM SHALL start text editing on that note with the cursor at the end of its text.

## Finish editing text

> Anchor: `sticky.edit_end`

WHEN a user presses Escape or clicks outside the note while editing THE SYSTEM SHALL stop editing and keep all text typed so far.

Verification: type, press Escape, the text remains; type more, click the board, the text remains.

## Text length limit

> Anchor: `sticky.text_limit`

IF typing or pasting would make a note's text longer than 1,000 characters THEN THE SYSTEM SHALL NOT add the characters beyond 1,000.

Verification: paste 1,200 characters into an empty note; the note contains exactly the first 1,000 and the counter shows 1000/1000.

## Text fits the note

> Anchor: `sticky.text_fit`

THE SYSTEM SHALL display note text at the largest size, from 24 down to 10 pixels at 100% zoom, at which all text fits inside the note, and WHEN text does not fit at the smallest size THE SYSTEM SHALL hide the overflow and show a fade at the note's bottom edge.

Verification: a one-word note shows large text; a 1,000 character note shows small text with a bottom fade and nothing drawn outside the note.

## Select and deselect

> Anchor: `sticky.select`

WHEN a user clicks a sticky note without dragging THE SYSTEM SHALL select it, showing an outline and the note toolbar, and WHEN the user clicks empty board space THE SYSTEM SHALL clear the selection.

## Move by dragging

> Anchor: `sticky.move`

WHEN a user drags a sticky note THE SYSTEM SHALL move the note so it stays under the pointer at any zoom level and show it on top of all other notes.

Verification: at 50% and at 200% zoom, drag a note; the point grabbed stays under the pointer (within 1 pixel) and the note is drawn above a note it overlaps.

## Dragging a note does not pan

> Anchor: `sticky.no_pan`

IF a drag starts on a sticky note THEN THE SYSTEM SHALL NOT move the board view.

Verification: drag a note; other notes and the grid stay in the same screen positions.

## Change colour

> Anchor: `sticky.color`

WHEN a user clicks one of the six colour swatches on a selected note's toolbar THE SYSTEM SHALL change that note's colour to the chosen colour and leave its text, position and selection unchanged.

## Delete a note

> Anchor: `sticky.delete`

WHEN a user presses Delete or Backspace while a note is selected and not being edited, or clicks the delete button on the note toolbar, THE SYSTEM SHALL remove that note from the board.

IF the note is being edited THEN THE SYSTEM SHALL NOT remove the note when Delete or Backspace is pressed; those keys edit text instead.

## Constraints

- **Scale:** the board stays responsive (dragging follows the pointer without visible lag) with 500 notes on the board on a mid-range laptop. Checked by a scripted performance run, not a hard pass/fail gate in this story.
- **Settings:** note size, colours, text limit and font size range are product settings defined in one place.
- **Accessibility:** the Sticky note button, swatches and delete button have accessible names; colour swatches are distinguishable by name (tooltip and accessible label), not only by colour; notes are reachable with Tab and editable with Enter.
- **Browsers:** same as story 1.
- **Future-proofing requirement:** notes must be stored in a form that can later be shared live between several people and saved, without users losing notes when those stories ship.

## Out of scope

- Saving notes across reload (story 4) and sharing them live (story 3).
- Resizing, rotating, multi-select, copy/paste of notes (story 7 and later).
- Undo/redo (story 8).
- Rich text, font choice, text alignment options.
- Custom colours beyond the six presets.
- Tags, votes, authorship labels on notes.
- Touch devices.

