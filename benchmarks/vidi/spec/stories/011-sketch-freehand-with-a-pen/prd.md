# PRD

Users sketch smooth freehand strokes in a chosen colour and thickness; each finished stroke becomes a normal board object that others see, and that can be selected by its line, moved, resized proportionally and deleted.

## Problem

Some ideas are faster to draw than to type: a quick arrow, a circle around a cluster of notes, an underline, a rough interface sketch. After stories 2 and 10, the board has notes, shapes and connectors, but nothing freehand.

Pain points:
1. **No freehand marks** — users cannot annotate, circle, underline or sketch.
2. **Shaky lines** — raw mouse and trackpad input looks jagged and unprofessional when shared.
3. **Marks get in the way** — on a physical whiteboard, drawings cannot be moved; in many tools sketches become a flat layer that cannot be selected, moved or deleted individually.
4. **Selecting the wrong thing** — a loose scribble has a large empty bounding box; clicking inside it to select a sticky note underneath must not grab the scribble.
5. **Noise for collaborators** — seeing half-drawn lines flicker on other screens is distracting and wastes bandwidth.
6. **Losing the pen** — tools that drop back to Select after each stroke make multi-stroke sketches tedious.

## Solution

- **No freehand marks → Pen tool.** Draw directly on the board in six colours and three thicknesses.
- **Shaky lines → smoothing.** Each stroke is smoothed when finished while staying faithful to what was drawn.
- **Marks in the way → strokes are objects.** Every finished stroke is an ordinary board object that can be moved, resized proportionally, deleted and undone.
- **Selecting the wrong thing → select by the line.** Only clicks close to the drawn line select a stroke.
- **Noise → share on finish.** Others see a stroke once it is finished, not while it is drawn.
- **Losing the pen → pen stays active.** The Pen tool stays active until the user chooses another tool or presses Escape; scrolling still moves around the board.

## User Experience

### Golden path
1. Priya presses **P** (or clicks the Pen button). The pointer becomes a small round cursor the size of the current thickness, and a pen toolbar appears next to the left toolbar: six colour swatches (black selected) and Thin / Medium (selected) / Thick.
2. She drags around a cluster of sticky notes: a line follows the pointer immediately.
3. She releases: the line is smoothed slightly and stays. Her colleague sees the circle appear.
4. She picks red and Thick and draws an underline under a note. The pen stays active.
5. She scrolls with the trackpad to another area and draws an arrow sketch.
6. She presses **V**, clicks on the red underline itself, and drags it a little lower. She drags a corner handle to make her arrow sketch larger; it grows in proportion.
7. She selects the circle and presses Delete.

### Structure
- Left toolbar: Pen button.
- Pen toolbar (visible while Pen is active): six colour swatches, three thickness buttons.
- Round pointer preview sized to the thickness at the current zoom.
- Stroke: smooth line with round ends and joins.

### Behaviour
- Dragging with the Pen draws; it never pans or moves objects underneath.
- Scrolling / trackpad two-finger movement pans the board while the Pen is active; Ctrl/Cmd+scroll zooms.
- A click without movement draws a round dot.
- Colour and thickness choices are remembered until the page is reloaded.
- Thickness is in board units, so strokes scale with zoom like everything else.
- Very long continuous strokes are split into consecutive strokes that join seamlessly.
- If the drag is interrupted (pointer leaves the window, system interruption) the stroke so far is kept.
- Selecting a stroke requires clicking within a few pixels of its line; clicking empty space inside its bounds selects what is underneath or nothing.
- Resizing a stroke keeps its proportions.
- Each finished stroke is one undo step.

### Alternate flows
- **Empty state:** Pen available on any board, including an empty one.
- **Offline:** strokes are kept locally and shared when the connection returns (story 3).
- **Two people drawing at once:** both strokes appear on both screens once finished.
- **Error states:** none beyond story 3's connection badge; a stroke with invalid input (e.g. no points) is discarded silently.

### Explicit non-behaviours
- Others do not see a stroke while it is being drawn.
- No eraser tool (delete strokes by selecting them), no pressure sensitivity, no highlighter transparency, no shape recognition.
- No editing individual points of a stroke.

## Draw a stroke

> Anchor: `pen.draw`

WHEN a user with the Pen tool active drags on the board THE SYSTEM SHALL draw a line following the pointer during the drag, updating at least once per displayed frame, and WHEN the user releases THE SYSTEM SHALL add a finished stroke in the chosen colour and thickness.

## Smoothing stays faithful

> Anchor: `pen.smooth`

WHEN a stroke is finished THE SYSTEM SHALL smooth it so that no point of the finished stroke lies farther than 1 screen pixel (at the zoom level used while drawing) from the path the user drew.

## Click draws a dot

> Anchor: `pen.dot`

WHEN a user with the Pen tool active clicks without moving THE SYSTEM SHALL add a round dot whose diameter equals the chosen thickness.

## Colour and thickness

> Anchor: `pen.options`

WHEN a user picks one of six colours or thin, medium or thick on the pen toolbar THE SYSTEM SHALL use that choice for subsequent strokes until the page is reloaded, and THE SYSTEM SHALL NOT change strokes already drawn.

## Pen stays active

> Anchor: `pen.stay_active`

WHILE the Pen tool is active THE SYSTEM SHALL keep it active after each finished stroke, and WHEN the user presses Escape or chooses another tool THE SYSTEM SHALL switch tools.

## Scrolling still navigates

> Anchor: `pen.navigation`

WHILE the Pen tool is active THE SYSTEM SHALL pan the board on scroll and zoom it on Ctrl/Cmd+scroll or pinch, and IF the user drags with the Pen THEN THE SYSTEM SHALL NOT pan the board or move objects under the pointer.

## Finished strokes are shared

> Anchor: `pen.share`

WHEN a user finishes a stroke THE SYSTEM SHALL show it on every other connected person's screen within 1 second, and IF the stroke is still being drawn THEN THE SYSTEM SHALL NOT show it to others.

## Select strokes by their line

> Anchor: `pen.select`

WHEN a user with the Select tool clicks within 6 screen pixels of a stroke's line (or within half its thickness, whichever is larger) THE SYSTEM SHALL select the stroke, and IF the click is farther from the line THEN THE SYSTEM SHALL NOT select it, even inside the stroke's bounds.

## Strokes resize in proportion

> Anchor: `pen.resize`

WHEN a user resizes a selected stroke THE SYSTEM SHALL scale the drawn line in proportion, keeping its width-to-height ratio, and keep the stroke's thickness unchanged.

## Very long strokes

> Anchor: `pen.long_stroke`

WHEN a stroke being drawn reaches 5,000 recorded points THE SYSTEM SHALL finish it and continue drawing as a new stroke starting at the same point, with no visible gap.

## Interrupted strokes are kept

> Anchor: `pen.interrupted`

IF a stroke drag is interrupted before release (pointer capture lost or cancelled by the system) THEN THE SYSTEM SHALL NOT discard the stroke; THE SYSTEM SHALL finish it with the points drawn so far.

## Constraints

- **Undo:** each finished stroke (and each part of a split long stroke) is one undo step (story 8).
- **Shared behaviour:** moving, resizing and deleting strokes use the shared selection behaviour (story 7).
- **Live collaboration:** follows story 3 (1 second delivery, capacity setting of 5 editors).
- **Responsiveness:** drawing keeps up with the pointer on a mid-range laptop (manual check); finished strokes should typically be much smaller than the raw input so sharing stays fast.
- **Settings:** colours, thicknesses, smoothing tolerance, selection tolerance and the point limit are named product settings.
- **Accessibility:** pen tool, swatches and thickness buttons have accessible names; strokes are announced as "Drawing".

## Out of scope

- Eraser, lasso, highlighter, pressure and tilt.
- Shape recognition (turning a rough circle into an ellipse).
- Showing strokes live while being drawn.
- Editing individual points; changing colour or thickness of existing strokes.
- Touch and stylus-specific behaviour (palm rejection).

