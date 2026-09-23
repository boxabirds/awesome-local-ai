# PRD

Users can move around an effectively unbounded board by dragging and scrolling, and zoom between overview and detail, with clear zoom feedback and a one-step way back to a known view.

## Problem

A physical whiteboard or a screen-sized drawing area runs out of room. When space runs out, people cram content together, erase earlier work, or split thinking across several boards — and lose the big picture.

Pain points:
1. **No room to grow** — a fixed-size area forces users to delete or squeeze content as a session progresses.
2. **Overview vs detail** — users need to see the whole picture and also read a single item closely; a fixed scale gives only one of those.
3. **Getting lost** — on a large surface with no orientation cues, users lose track of where they are and how zoomed in they are, and have no quick way back.
4. **Fighting the browser** — zoom gestures that zoom the whole web page (toolbar and all) instead of the board make navigation feel broken.

Every later capability (sticky notes, shapes, collaboration) depends on users being able to move around the board comfortably. If navigation is clumsy, the product is unusable regardless of other features.

## Solution

The board behaves as an effectively endless surface that users navigate the way they already navigate maps and design tools.

- **No room to grow → unbounded board.** Users can keep moving in any direction and never hit an edge.
- **Overview vs detail → zoom.** Users zoom out to see everything or in to read closely, using the gestures they already know (pinch, Ctrl/Cmd + scroll) or on-screen buttons. Zooming keeps the spot under the pointer in place, so users zoom *into* what they are looking at.
- **Getting lost → orientation cues and reset.** A subtle dot grid moves with the board so movement is visible even on an empty board. The current zoom percentage is always shown. One click or shortcut returns to a standard view.
- **Fighting the browser → board-owned gestures.** Zoom gestures over the board zoom the board only, never the web page.

## User Experience

### Golden path
1. User opens the app and sees a full-window board with a light dot grid.
2. A short hint is shown near the bottom centre: "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom".
3. User presses on empty board space and drags: the board follows the pointer exactly; the pointer shows a grabbing hand while dragging. The hint disappears.
4. User scrolls with a mouse wheel or two fingers on a trackpad: the board moves in the scroll direction.
5. User pinches on a trackpad (or holds Ctrl/Cmd and scrolls): the board zooms in or out around the pointer position.
6. User looks at the zoom control in the bottom-right corner: it shows − , the current zoom (e.g. "150%"), +, and a Reset view button.
7. User clicks Reset view (or presses Ctrl/Cmd + 0): the board returns to 100% zoom centred on the board's starting point.

### Structure
- Full-window board area with dot grid background.
- Bottom-right zoom control: zoom-out button (−), zoom percentage label, zoom-in button (+), Reset view button.
- Bottom-centre first-use hint (temporary).

### Behaviour
- Zoom buttons zoom one step around the centre of the screen.
- Ctrl/Cmd + = and Ctrl/Cmd + − zoom one step around the centre of the screen.
- Zoom percentage is a whole number and updates as the user zooms.
- At the minimum zoom (10%) the − button is disabled and further zoom-out does nothing; at the maximum zoom (400%) the + button is disabled and further zoom-in does nothing.
- Dot grid spacing and position move with pan and zoom so the grid appears attached to the board.
- Resizing the browser window does not move content relative to the top-left corner of the board area.
- The hint disappears after the user's first pan or zoom and does not return during that visit.

### Alternate flows
- **Empty state:** the board is always empty in this story; the dot grid and hint are the empty state.
- **Pointer leaves the window mid-drag / drag interrupted by the system (e.g. alert, touch cancel):** the drag ends; the board stays where it was at the moment of interruption.
- **Error states:** this story has no network or data operations, so there are no error messages. The board works with no connection.
- **Very far from the start:** after panning a very long way, content and grid still render crisply and Reset view still returns to the start.

### Explicit non-behaviours
- Does not share a user's view with anyone else; each person's view is their own.
- Does not remember the view after the page is reloaded.
- Does not add momentum/inertia beyond what the operating system provides.
- Does not support touch-screen pinch or one-finger drag on phones/tablets.
- Does not zoom the browser page when zoom gestures are used over the board.

## Pan by dragging

> Anchor: `pan.drag`

WHEN a user presses on empty board space and drags THE SYSTEM SHALL move the board content by exactly the distance and direction the pointer moved.

Verification: start a drag at a visible grid dot; after dragging 200 pixels right and 100 pixels down, the same dot is 200 pixels right and 100 pixels down from where it started, within 1 pixel.

## Pan by scrolling

> Anchor: `pan.scroll`

WHEN a user scrolls over the board with a mouse wheel or two-finger trackpad gesture without holding Ctrl or Cmd THE SYSTEM SHALL move the board in the scroll direction, both vertically and horizontally.

Verification: scroll down; content moves up. Scroll right with a trackpad; content moves left.

## Zoom around the pointer

> Anchor: `zoom.pointer`

WHEN a user pinches on a trackpad or scrolls while holding Ctrl or Cmd over the board THE SYSTEM SHALL zoom the board while keeping the board location under the pointer at the same screen position.

Verification: hover over a distinctive grid dot, zoom in and out; the dot stays under the pointer within 1 pixel.

## Zoom with buttons and keys

> Anchor: `zoom.step`

WHEN a user clicks the + or − zoom button or presses Ctrl/Cmd + = or Ctrl/Cmd + − THE SYSTEM SHALL change the zoom by one step while keeping the board location at the centre of the board area at the same screen position.

Verification: from 100%, one click on + gives 125%; one click on − from 125% returns to 100%.

## Zoom limits

> Anchor: `zoom.limits`

WHILE the zoom is at its minimum (10%) or maximum (400%) THE SYSTEM SHALL ignore further zooming past that limit and disable the zoom button that would exceed it.

Verification: repeatedly zoom out; the label stops at 10% and − becomes disabled. Repeatedly zoom in; the label stops at 400% and + becomes disabled. Zooming back the other way re-enables the button.

## Zoom level shown

> Anchor: `zoom.indicator`

THE SYSTEM SHALL display the current zoom level as a whole-number percentage that updates whenever the zoom changes.

Verification: after any zoom action, the label matches the zoom level rounded to the nearest whole percent.

## Reset view

> Anchor: `view.reset`

WHEN a user clicks Reset view or presses Ctrl/Cmd + 0 THE SYSTEM SHALL set the zoom to 100% and centre the board's starting point in the board area.

Verification: pan far away and zoom to 300%, press Reset view; the label shows 100% and the starting point marker position is the centre of the board area.

## No edges

> Anchor: `pan.unbounded`

THE SYSTEM SHALL allow the user to pan at least 1,000,000 board units from the starting point in any direction without reaching an edge or visible distortion of the grid.

Verification: navigate to a location 1,000,000 units away (test shortcut allowed); the grid renders evenly spaced and panning still follows the pointer exactly.

## Board gestures do not zoom the page

> Anchor: `zoom.no_page_zoom`

IF a user pinches or scrolls with Ctrl/Cmd held over the board, or presses Ctrl/Cmd + = / − / 0 while the board is focused, THEN THE SYSTEM SHALL NOT change the browser's page zoom.

Verification: after these gestures, the zoom control and page text remain their normal size; only board content scale changes.

## First-use navigation hint

> Anchor: `nav.hint`

WHEN the board opens and the user has not yet panned or zoomed during this visit THE SYSTEM SHALL show the navigation hint, and WHEN the user first pans or zooms THE SYSTEM SHALL hide it for the rest of the visit.

Verification: open the app, see the hint; drag once, the hint disappears; further navigation does not bring it back until the page is reloaded.

## Constraints

- **Browsers:** current and previous major versions of desktop Chrome, Edge, Firefox and Safari.
- **Input devices:** mouse with wheel, and laptop trackpads (macOS and Windows precision touchpads).
- **Smoothness:** panning and zooming on an empty board should feel fluid (target: no visible stutter at 60 frames per second on a mid-range laptop). This is checked manually; it is not an automated pass/fail criterion in this story.
- **Accessibility:** zoom buttons and Reset view are keyboard focusable and have accessible names ("Zoom out", "Zoom in", "Reset view"); the zoom label is announced when it changes.
- **Settings:** zoom minimum, maximum and step size are product settings that can be changed in one place without redesign.

## Out of scope

- Any objects on the board (sticky notes arrive in story 2).
- Zoom to fit content (needs content; later).
- Minimap or "where am I" overview panel.
- Remembering each user's view between visits.
- Following another user's view or presenting a view to others.
- Touch-screen and mobile navigation.
- Keyboard arrow-key panning.

