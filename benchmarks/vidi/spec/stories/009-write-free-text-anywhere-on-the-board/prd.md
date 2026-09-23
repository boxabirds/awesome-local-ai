# PRD

A Text tool lets users place plain text anywhere on the board as headings, labels and annotations; text grows then wraps, comes in four sizes, can be given a fixed width, and behaves like every other object for selection, moving, deleting, undo and live sharing.

## Problem

The only way to put words on the board is a sticky note.

Pain points:
1. **No headings** — teams cannot title areas of a board ("Went well", "To improve"); they misuse sticky notes, which look like ideas and get moved or voted on by mistake.
2. **Clutter** — short labels and annotations on coloured squares make a board noisy and hard to scan.
3. **No hierarchy** — without size differences, a section heading looks as important as a detail.
4. **Layout control** — longer annotations either stretch across the board in one line or need manual line breaks.
5. **Inconsistency risk** — a new kind of object that doesn't select, move, delete and undo like notes would confuse users.

## Solution

- **No headings → free text.** A Text tool (T) places plain text with no background anywhere on the board.
- **Clutter → minimal appearance.** Text has no fill, border or shadow.
- **No hierarchy → sizes.** Four sizes (S, M, L, XL) make headings stand out.
- **Layout control → grow then wrap, or fixed width.** Text widens as you type up to a comfortable line length, then wraps; dragging a side handle sets a fixed width.
- **Inconsistency → same object behaviour.** Text is selected, moved, deleted, undone and shared live exactly like sticky notes (stories 3, 7, 8).

## User Experience

### Golden path
1. Ava presses T. The Text tool in the left toolbar shows as active and the pointer becomes a text cursor over the board.
2. She clicks empty space above a cluster of notes. A text cursor appears there; the tool switches back to Select.
3. She types "Went well"; the text grows to the right as she types.
4. She presses Escape. The text stays, shown as selected.
5. In the small text toolbar above it she picks XL; the heading becomes large, its top-left corner stays put.
6. She drags it to centre it over the cluster, then drags its right-side handle to make it narrower; the words wrap onto two lines.
7. Her colleague sees the heading appear, grow and move live.

### Structure
- Left toolbar: Select (V) and Text (T) tool buttons join the existing Sticky note button (N); the active tool is highlighted.
- Text object: plain text, no background.
- Text toolbar when exactly one text object is selected: S, M, L, XL size buttons (current one highlighted) and Delete.
- Selected text shows left and right side handles only.

### Behaviour
- Text tool: next click on the board creates text there; the tool returns to Select afterwards. Escape or V also returns to Select without creating.
- N keeps its story 2 behaviour: creates a sticky note in the centre of the view.
- New text is size M.
- Typing: Enter adds a new line; Escape or clicking elsewhere ends editing.
- Auto width: the text box is as wide as its longest line, up to 600 board units, then lines wrap.
- Dragging a side handle sets a fixed width (minimum 40 board units); text rewraps; height always follows the content.
- Changing size keeps the top-left position; auto-width text re-measures, fixed-width text rewraps.
- Double-click text or press Enter with it selected to edit; the cursor goes to the end.
- Text can be selected with notes, moved, nudged, deleted and undone (stories 7, 8).
- Maximum 5,000 characters; extra characters are not added.

### Alternate flows
- **Empty text:** ending editing with no characters removes the text object entirely (it never becomes an invisible object).
- **Text tool click on top of an existing object:** new text is created on top at that point.
- **Two people typing in the same text:** both people's characters are kept (story 3).
- **Someone deletes text I am editing:** editing ends without error (story 3).
- **Board failed to load:** the Text tool is disabled.

### Explicit non-behaviours
- No bold, italic, underline, lists, links, text colour, font choice or alignment.
- No rotation.
- No vertical resize handles; height is always automatic.
- Does not convert sticky notes to text or back.

## Activate the Text tool

> Anchor: `text.tool`

WHEN a user presses T or clicks the Text tool button THE SYSTEM SHALL make Text the active tool and highlight its button, and WHEN the user presses Escape or V, or clicks Select, THE SYSTEM SHALL return to the Select tool without creating anything.

## Place text

> Anchor: `text.create`

WHILE the Text tool is active WHEN a user clicks the board THE SYSTEM SHALL create a size M text object with its top-left at the clicked point, start editing it, and make Select the active tool.

## Edit existing text

> Anchor: `text.edit`

WHEN a user double-clicks a text object, or presses Enter while exactly one text object is selected, THE SYSTEM SHALL start editing it with the cursor at the end, and WHEN the user presses Escape or clicks elsewhere THE SYSTEM SHALL stop editing and keep all typed text.

WHILE editing text WHEN the user presses Enter THE SYSTEM SHALL insert a new line.

## Text grows then wraps

> Anchor: `text.auto_width`

WHILE a text object has no fixed width THE SYSTEM SHALL make its width equal to its longest line, up to 600 board units, and SHALL wrap any line longer than 600 board units.

Verification: typing "Went well" produces a box just wider than the words; pasting a 300-character sentence produces a 600-unit-wide box with wrapped lines.

## Fixed width by side handle

> Anchor: `text.fixed_width`

WHEN a user drags the left or right handle of a selected text object THE SYSTEM SHALL set a fixed width no smaller than 40 board units, rewrap the text to that width, and adjust the height to fit the content.

## Height follows content

> Anchor: `text.height`

THE SYSTEM SHALL keep every text object's height equal to the height of its content, and SHALL NOT offer handles that change a text object's height directly.

## Text sizes

> Anchor: `text.size`

WHEN a user picks S, M, L or XL in the text toolbar of a selected text object THE SYSTEM SHALL change its text size to that preset, keep its top-left position, and recompute its width (if automatic) and height.

## Empty text is removed

> Anchor: `text.empty_removed`

IF editing of a text object ends and it contains no characters THEN THE SYSTEM SHALL remove the text object and SHALL NOT leave an invisible object on the board.

## Text length limit

> Anchor: `text.limit`

IF typing or pasting would make a text object longer than 5,000 characters THEN THE SYSTEM SHALL NOT add the characters beyond 5,000.

## Behaves like other objects

> Anchor: `text.consistent`

THE SYSTEM SHALL let text objects be selected (including box select and select all), moved, nudged, deleted, undone and redone, and shared live with other people in the same way as sticky notes.

## Simultaneous typing merges

> Anchor: `text.concurrent`

WHEN two or more people type in the same text object at the same time THE SYSTEM SHALL keep every character each of them typed and show identical text on all screens once typing stops.

## Unavailable when the board cannot be edited

> Anchor: `text.not_editable`

WHILE the board cannot be edited because it failed to load THE SYSTEM SHALL disable the Text tool and SHALL NOT start text editing.

## Constraints

- **Settings:** maximum automatic width (600), minimum fixed width (40), size presets (S 14, M 20, L 32, XL 56 board units) and the 5,000-character limit are named settings.
- **Readability:** text uses the board's standard sans-serif font and remains crisp at every zoom level.
- **Collaboration:** up to 5 simultaneous editors (configured capacity) may create and edit text concurrently.
- **Accessibility:** text objects are reachable with Tab, announced by their content; tool buttons have accessible names and pressed state; size buttons announce their size.
- **Compatibility:** boards without text objects are unaffected; older clients that don't know the text type skip it rather than failing.

## Out of scope

- Rich text formatting, colours, fonts, alignment.
- Rotation.
- Converting between sticky notes and text.
- Spell-check customisation beyond the browser default.
- Tools for shapes, connectors, pen and images (stories 10–12).

