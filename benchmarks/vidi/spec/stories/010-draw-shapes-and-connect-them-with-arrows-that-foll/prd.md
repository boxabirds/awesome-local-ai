# PRD

Users draw rectangles, ellipses and diamonds with labels and colours, and connect objects with arrows that stay attached as objects move, for everyone on the board.

## Problem

Sticky notes (story 2) capture ideas but cannot express structure. Teams sketching a process, a system or an org chart need boxes and the lines between them.

Pain points:
1. **No structure** — flows, dependencies and hierarchies cannot be drawn with notes alone.
2. **Relationships break when rearranging** — on a physical whiteboard, moving a box means erasing and redrawing every line to it; in simple tools, lines stay behind when boxes move.
3. **Everything looks the same** — without different shapes and colours, decisions, steps and systems are hard to tell apart.
4. **Diagrams need words** — a box without a label is meaningless.
5. **Collaborators pull things apart** — when one person moves a box, others must see the lines follow too, or the shared diagram becomes wrong.

## Solution

- **No structure → shapes.** Users draw rectangles, ellipses and diamonds by dragging, or click to drop a standard-size shape.
- **Relationships break → attached arrows.** Users drag an arrow from one object to another; the arrow stays attached to both and redraws whenever either object moves or is resized, by anyone. Arrow ends can be re-attached later.
- **Everything looks the same → fill and outline colours.** A selected shape can be recoloured from a small toolbar.
- **Diagrams need words → labels.** Double-click a shape to type a centred label that stays inside the shape.
- **Collaborators → live.** Shapes and arrows appear and follow moves on every connected person's screen.

## User Experience

### Golden path
1. Dana presses **S** (or clicks the Shape button in the left toolbar). A small menu next to the button shows Rectangle (selected), Ellipse, Diamond.
2. Dana drags on the board: a rectangle outline follows the pointer. On release a white rectangle with a dark outline appears and is selected.
3. Dana double-clicks it and types "Checkout". The label is centred and wraps inside the shape.
4. Dana picks Diamond from the Shape menu and clicks once on the board: a standard-size diamond appears centred on the click. She labels it "Paid?".
5. Dana presses **L** (Connector). Hovering over the rectangle shows four small connection dots on its sides. She drags from the rectangle to the diamond; while dragging, the diamond's nearest side dot highlights. On release an arrow joins the two shapes.
6. Dana switches to Select (**V**) and drags the diamond elsewhere: the arrow follows. Her colleague sees the same thing on their screen.
7. Dana selects the rectangle and picks a light blue fill from the shape toolbar.

### Structure
- Left toolbar: Shape button (with kind menu) and Connector button, alongside existing tools.
- Shape: fill, outline, centred label.
- Shape toolbar (selected shape only): fill swatches (6 colours + no fill), outline swatches (6 colours).
- Connector: straight line with an arrowhead at the end; selected arrows show a handle at each end.
- Connection dots: four side midpoints shown on the object under the pointer while the Connector tool is active.

### Behaviour
- After creating a shape or arrow, the tool returns to Select so the new item can be adjusted; Escape also returns to Select.
- Shift while dragging a new shape makes it square / circular.
- Arrows attach to the side of each object nearest the other end, and switch sides automatically as objects move.
- Releasing an arrow over empty space leaves that end free, pinned to the board point.
- Dragging a selected arrow's end handle onto another object re-attaches it; onto empty space detaches it.
- Clicking close to an arrow's line selects it; clicking inside an arrow's bounding box but away from the line does not.
- Arrows can connect shapes, sticky notes, and any other board object.
- Deleting an object keeps its arrows; their ends stay where the object's side was.
- Resizing a shape keeps its label centred and re-wrapped.

### Alternate flows
- **Empty state:** no shapes; tools always available.
- **Tiny drag:** a drag smaller than the minimum shape size creates a standard-size shape instead (treated as a click).
- **Arrow released on its own starting object, or dragged only a few pixels:** no arrow is created.
- **Someone deletes a shape while I am drawing an arrow to it:** my arrow is created with a free end where the shape was.
- **Label too long:** stops accepting text at 500 characters.
- **Error states:** no network operations beyond live sync (story 3); connection problems show story 3's badge.

### Explicit non-behaviours
- No elbow/curved arrows, arrow labels, dashed lines or arrowhead choices.
- No other shape kinds (triangles, stars, flowchart library).
- No changing a shape's kind after creation.
- No rotation.
- No automatic layout or alignment guides.

## Draw a shape by dragging

> Anchor: `shape.create_drag`

WHEN a user with the Shape tool active drags on the board THE SYSTEM SHALL create a shape of the chosen kind (rectangle, ellipse or diamond) exactly covering the dragged area, and select it.

Verification: at 100% zoom, dragging from (100,100) to (300,220) screen pixels creates a shape 200 × 120 board units at that position.

## Drop a standard shape by clicking

> Anchor: `shape.create_click`

WHEN a user with the Shape tool active clicks without dragging, or drags an area smaller than the minimum shape size (20 board units in either direction), THE SYSTEM SHALL create a standard-size shape (160 × 160 board units) centred on the click point.

## Constrain proportions with Shift

> Anchor: `shape.constrain`

WHILE the user holds Shift during a shape drag THE SYSTEM SHALL make the new shape's width equal to its height, using the larger of the two dragged dimensions.

## Label a shape

> Anchor: `shape.label`

WHEN a user double-clicks a shape THE SYSTEM SHALL start editing a label centred inside the shape, wrapping within the shape's width, and THE SYSTEM SHALL NOT accept label text beyond 500 characters.

Verification: type a sentence longer than the shape is wide; it wraps and remains centred; resizing the shape re-wraps it and keeps it centred.

## Colour a shape

> Anchor: `shape.style`

WHEN a user picks a fill swatch (six colours or no fill) or an outline swatch (six colours) on a selected shape's toolbar THE SYSTEM SHALL apply that colour to the shape without changing its label, size, position or selection.

## Connect two objects

> Anchor: `connector.create_attached`

WHEN a user with the Connector tool active drags from one board object and releases over a different board object THE SYSTEM SHALL create an arrow from the first object to the second, attached to the side of each object nearest the other.

## Arrow to empty space

> Anchor: `connector.create_free`

WHEN a user with the Connector tool active releases the drag over empty board space THE SYSTEM SHALL create an arrow whose end is fixed at that board point, and WHEN the drag starts on empty space THE SYSTEM SHALL fix the arrow's start at that board point.

## No accidental arrows

> Anchor: `connector.no_accidental`

IF a connector drag ends on the same object it started on, or the pointer moved less than 8 board units, THEN THE SYSTEM SHALL NOT create an arrow.

## Arrows follow objects

> Anchor: `connector.follow`

WHEN an object with attached arrows is moved or resized by any person on the board THE SYSTEM SHALL redraw each attached arrow end at the nearest side of the object's new position on every connected person's screen within 1 second.

Verification: Dana drags a connected shape across the arrow's other end; on both Dana's and Sam's screens the arrow stays attached and switches to the nearer side.

## Connection points are shown

> Anchor: `connector.hover_points`

WHILE the Connector tool is active and the pointer is over a board object THE SYSTEM SHALL show connection dots at the midpoints of that object's four sides, and WHILE dragging an arrow over a target object THE SYSTEM SHALL highlight the dot the arrow will attach to.

## Select an arrow precisely

> Anchor: `connector.select`

WHEN a user clicks within 6 screen pixels of an arrow's line with the Select tool THE SYSTEM SHALL select that arrow, and IF the click is farther than that from the line THEN THE SYSTEM SHALL NOT select the arrow.

## Move an arrow's ends

> Anchor: `connector.reattach`

WHEN a user drags an end handle of a selected arrow and releases it over a board object THE SYSTEM SHALL attach that end to the object, and WHEN released over empty space THE SYSTEM SHALL detach that end and fix it at the release point.

## Deleting a connected object keeps arrows

> Anchor: `connector.target_deleted`

WHEN an object with attached arrows is deleted THE SYSTEM SHALL keep those arrows and fix each formerly attached end at the point where it was attached, and IF the object disappears because another person deleted it at the same moment an arrow was being attached THEN THE SYSTEM SHALL NOT fail to show that arrow.

## Return to Select after creating

> Anchor: `tools.return_to_select`

WHEN a shape or arrow has been created THE SYSTEM SHALL switch the active tool back to Select and keep the new item selected, and WHEN the user presses Escape with the Shape or Connector tool active THE SYSTEM SHALL switch to Select without creating anything.

## Constraints

- **Live collaboration:** shapes, labels, colours and arrows follow story 3's guarantees (visible to others within 1 second, simultaneous edits merge, capacity setting of 5 editors).
- **Undo:** creating, restyling, labelling and re-attaching are each one undo step (story 8 conventions).
- **Selection, moving, resizing and deleting** use the shared selection behaviour (story 7) — shapes and arrows behave like every other object.
- **Settings:** default and minimum shape size, colour palettes, label limit, arrow click tolerance and minimum arrow length are named product settings.
- **Performance:** a board with 300 shapes and 300 arrows keeps dragging smooth (manual check).
- **Accessibility:** tools and swatches have accessible names; shapes and arrows are announced with their kind and label.

## Out of scope

- Elbow, curved or multi-segment arrows; arrow labels; line styles; arrowhead options.
- Additional shape kinds and shape libraries.
- Changing a shape's kind, rotation, text formatting inside labels.
- Alignment guides, snapping, auto-layout.
- Grouping.

