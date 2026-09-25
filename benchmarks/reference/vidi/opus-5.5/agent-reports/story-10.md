# Story 10: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 10 is built and committed as `eb62a2d story 10: Draw shapes and connect them with arrows that follow when moved`. Every build and test script passes. WebKit e2e was not run because WebKit can't launch on the build machine.

## What I built
- **Model**:
  - New files `src/shared/objects/shape.ts` and `src/shared/objects/connector.ts`, plus geometry in `src/shared/geometry/connector-geometry.ts` and `polyline.ts`.
  - Arrow ends store no side. The side each end sits on is recalculated from the objects' current positions on every render, so arrows follow moves by anyone and switch sides without writing anything.
  - Deleting an object turns the arrow ends attached to it into free ends at the same point, in the same transaction.
  - The story 10 settings are in `src/shared/config.ts`.
- **Tools** (`src/client/tools/`):
  - `useActiveTool` handles tool state; S and L are the shortcuts, Escape returns to Select, and creating something selects it and returns to Select.
  - **Shape tool**: dashed preview while dragging, Shift makes it square, a click or tiny drag drops a standard 160 × 160 shape.
  - **Connector tool**: connection dots on hover, the target's dot highlights while dragging, and no arrow is created if it's released on its starting object or moved less than 8 units.
- **Objects**:
  - `ShapeObject` draws a rectangle, ellipse or diamond with a centred label that wraps and is limited to 500 characters.
  - `ShapeToolbar` has 7 fill swatches, 6 outline swatches and a Delete button.
  - `ConnectorObject` draws the line and arrowhead. When selected it shows a handle at each end: drag one onto an object to re-attach, onto empty space to detach, or onto the object at the other end and it snaps back.
- **Board**: the toolbar has a Shape button with a Rectangle / Ellipse / Diamond menu, and a Connector button. A click within 6 screen pixels of an arrow's line selects it, at any zoom. Moving or resizing a selection also moves or scales the arrows' free ends.
- **Tests**: unit TC-01 to TC-14 and TC-29; component TC-15 to TC-22 and TC-28; e2e TC-23 to TC-27; plus the checkout-flow fixture.

## Final results
| Script | Result |
|---|---|
| `npm run build` | pass |
| `npm run typecheck` | pass |
| `npm run test:unit` | 18 files, 204/204 passed |
| `npm run test:component` | 19 files, 201/201 passed |
| `npm run test:integration` | 5 files, 61/61 passed |
| `npm run test:e2e` (Chromium + Firefox) | 96 passed, 0 failed, 3 skipped (all 3 skips existed before this story) |
| `npm run test:e2e:nightly` (Chromium) | 2/2 passed (TC-30: p50 263 ms, p95 431 ms, max 941 ms) |

I also checked screenshots of the checkout-flow board, the shape preview and the arrow preview in Chromium, and they render correctly.

## Left undone
- **WebKit**: TC-23 was not run there because WebKit can't launch on the build machine.
- **Manual checks**: the 300 shapes + 300 arrows smoothness check is manual, per the design.
- **Test-first order**: the new tests were not run against "not implemented" stubs first. Instead I broke the code on purpose twice (a wider arrow click tolerance, and removing the "released on its own starting object" rule); the tests caught both, and I reverted them.

## Decisions noted in NOTES.md
- `useActiveTool` is in `tools/` and takes optional `{canEdit, onSelect}`. Story 9's `useTool` now just wraps it, and the key shortcuts stay in `useBoardKeys`. Selection gained `adopt(id)` so a just-created item can be selected before the board snapshot includes it.
- The Shape and Connector tools use a transparent input layer over the board, so a drag that starts on an existing object never moves it. That needed a new `overlay` prop on `BoardViewport` and `isolation: isolate` so the layer stays below the panels.
- Arrows take no pointer events themselves. Instead the board checks each press, through a new `onPressCapture` prop, for an arrow within 6 px and stacked above whatever was pressed.
- The object registry is split into `objectTypes.ts` and `registry.tsx` to avoid a module import loop. The hit test takes an optional zoom, and two new flags are `attachable` (arrows can't connect to other arrows) and `selectionBox` (arrows show end handles instead of the selection box).
- Following story 9's pattern, `board-model.ts` reads shapes and arrows itself and derives each arrow's box. `detachConnectorsTo` lives there and is re-exported from `connector.ts`. Arrow ends are stored as plain values, and if two people change the same end at once, the last write wins.
- **Resolved decisions**:
  - When moving arrows, only free ends move; attached ends follow their objects.
  - When an end sits exactly on a diagonal, the left/right side wins.
  - `ConnectorObject` takes the standard object props rather than the design's `rects` prop, and reads other objects through a context.
  - An arrow end whose object has vanished is converted to a free end at its stored point on the next edit to that arrow.
  - Shift-squaring keeps the drag-origin corner fixed, and the minimum-size check comes before squaring.
- The label is an HTML box over the SVG rather than a `foreignObject`. I added two settings the design didn't name: `SHAPE_LABEL_FONT_PX` = 16 and `CONNECTOR_COLOR`.
- **Accessible names**:
  - Tool buttons: "Shape (S)" (menu "Shape kind"), "Connector (L)".
  - Shape toolbar: "No fill", "<Colour> fill", "<Colour> outline", "Delete shape".
  - Shapes are announced as "Rectangle: Checkout".
  - Arrows are "Arrow", with end handles "Arrow start" and "Arrow end".
- Story 8's TC-18 test lists the toolbar buttons, so I updated it to include the two new buttons; nothing else in it changed.
- TC-27 forces the delete race by holding back Sam's outgoing WebSocket messages with `routeWebSocket` until Dana has drawn her arrow, rather than using a timed delay. This makes the overlap deterministic.
