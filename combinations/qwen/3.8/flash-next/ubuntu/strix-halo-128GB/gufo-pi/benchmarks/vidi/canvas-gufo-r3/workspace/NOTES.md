# Story 11 — Sketch freehand with a pen

## What was built

### Task 1: Unit tests (TC-01 to TC-08)
- `tests/unit/stroke.test.ts` — 8 tests covering RDP simplification, point splitting, createStroke geometry, scaledPoints, stroke hit test, smoothPath, roundTrip snapshot
- `tests/fixtures/pen-paths.ts` — straight line, closed loop (square), squiggle fixture

### Task 2: Stroke model and geometry
- `src/shared/geometry/simplify.ts` — `simplify()` (iterative RDP), `splitPoints()`, `smoothPath()` (quadratic bezier through midpoints)
- `src/shared/objects/stroke.ts` — `createStroke()` using `LOCAL_ORIGIN`, `scaledPoints()`, `snapshotStroke()`, `StrokeSnap` interface
- `src/shared/config.ts` — PEN_COLORS, PEN_THICKNESS_WORLD, DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD
- `src/shared/board-model.ts` — StrokeSnap added to ObjectSnapshot union, snapshotAll includes strokes

### Task 3: Pen tool, toolbar, options
- `src/client/tools/PenTool.tsx` — pointer-capture overlay, coalesced events, rAF preview path, commit on up/cancel/max-points, wheel forwarding for pan/zoom while pen is active
- `src/client/tools/PenToolbar.tsx` — 6 colour swatches, 3 thickness buttons with aria-labels
- `src/client/tools/usePenOptions.ts` — session-only state hook for pen colour/thickness
- `src/client/board/Toolbar.tsx` — Pen button with shortcut P
- `src/client/tools/useActiveTool.ts` — Pen is a staying-active tool; Escape returns to select
- `src/client/board/useBoardKeys.ts` — Escape handles pen→select transition

### Task 4: StrokeObject and registry
- `src/client/objects/StrokeObject.tsx` — SVG path rendered from scaledPoints + smoothPath, aspect-locked resize, selected stroke styling
- `src/client/objects/registry.ts` — hitTest signature updated to accept optional `zoom` parameter
- `src/client/Board.tsx` — stroke registered (aspectLocked, minSize, line-distance hitTest), PenTool overlay rendered, PenToolbar rendered, pen routing disables pan/marquee, stroke in object list

### Task 5: Component tests (TC-09 to TC-16, TC-21)
- `tests/component/PenTool.test.tsx` — 9 tests: preview during drag, commit, color+thickness, tool stays active, cancel on pointer cancel, max-points split, toolbar swatches, toolbar thickness
- `tests/component/StrokeObject.test.tsx` — 3 tests: render path, scaled points on resize, selection highlight

### Task 6: E2E tests (TC-17 to TC-20)
- `tests/e2e/pen.spec.ts` — 4 tests: draw + preview + persist, other participant sees stroke after release only, wheel pans + sticky not moved, select+resize+move+delete
- `tests/e2e/helpers/pen.ts` — locators and helpers for pen tool interaction

## Key design decisions

1. **LOCAL_ORIGIN**: `createStroke` places strokes at `{x: 0, y: 0}` with `baseWidth/baseHeight` in LOCAL coordinates. The caller translates to world position via `updateBounds`. This avoids double-subtracting origin in `scaledPoints`.

2. **Aspect-locked resize**: Width/height change proportionally when a resize handle is dragged, preserving the aspect ratio (width/height = baseWidth/baseHeight). Thickness is unchanged.

3. **Wheel forwarding**: The PenTool overlay sits on top of BoardViewport, so it intercepts wheel events. The PenTool has its own wheel listener that forwards to the camera's wheel handler, allowing pan/zoom while drawing mode is active.

4. **Hit testing**: Stroke selection uses line-distance (tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX/zoom)). Empty interior space does NOT hit the stroke.

5. **Session-only pen options**: Color and thickness reset to defaults on page refresh — no localStorage persistence.

6. **Smooth rendering**: Uses quadratic bezier through midpoints (`smoothPath`) for visually smooth strokes from simplified points.

## Test results

- Unit: 214 tests pass (20 files)
- Component: 135 tests pass (20 files)
- Integration: 48 tests pass
- E2E: all pass including 4 new pen tests (TC-17 to TC-20); 1 pre-existing flaky test (TC-26 live-collaboration convergence)

## Files created/modified

Created:
- src/shared/geometry/simplify.ts
- src/shared/objects/stroke.ts
- src/client/tools/PenTool.tsx
- src/client/tools/PenToolbar.tsx
- src/client/tools/usePenOptions.ts
- src/client/objects/StrokeObject.tsx
- tests/unit/stroke.test.ts
- tests/fixtures/pen-paths.ts
- tests/component/PenTool.test.tsx
- tests/component/StrokeObject.test.tsx
- tests/e2e/pen.spec.ts
- tests/e2e/helpers/pen.ts

Modified:
- src/shared/config.ts
- src/shared/board-model.ts
- src/client/Board.tsx
- src/client/board/Toolbar.tsx
- src/client/board/useBoardKeys.ts
- src/client/tools/useActiveTool.ts
- src/client/objects/registry.ts
- tests/e2e/helpers/sticky.ts (added seedSticky)
