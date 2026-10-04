# Story 11 Notes

## Decisions

- **StrokeObject hit testing**: The SVG element uses `pointer-events: auto` (not `none`) so it can
  receive pointer events in real browsers. The hit test is done in JavaScript using
  `distanceToPolyline` — if the click is not near the line, the event is not stopped and bubbles
  up to the board (selecting what's underneath or deselecting). This is necessary because SVG
  path `pointer-events: stroke` does not work reliably inside CSS-transformed containers in
  Chromium.

- **PenTool wheel handling**: The pen tool overlay handles wheel events itself (pan/zoom) and
  calls `onWheel` prop to update the camera, matching the BoardViewport behavior. This ensures
  navigation works while the pen tool is active.

- **StrokeObject CSS**: Changed `.stroke-object` from `pointer-events: none` to `pointer-events: auto`
  with `cursor: pointer` to enable selection by clicking near the line.

## Pre-existing test failures (not caused by this story)

- `BoardViewport.test.tsx`: 8 failures (viewport.input tests)
- `NavigationHint.test.tsx`: 1 failure
- `load-failure.test.tsx`: 4 failures

These were confirmed pre-existing via `git stash` before this story's changes.
