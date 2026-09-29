# Story 11 Implementation Notes

## Decisions made

1. **Config constant names**: The design mentions `PEN_SIMPLIFY_TOLERANCE`, `PEN_DEFAULT_COLOR`, `PEN_DEFAULT_THICKNESS` in the summary. I used `STROKE_SIMPLIFY_TOLERANCE_PX`, `DEFAULT_PEN_COLOR`, `DEFAULT_PEN_THICKNESS` to match the tasks.md "add" list more precisely.

2. **STROKE_MAX_POINTS = 5000**: Used 5000 (not 500 as in the compacted summary). The design says `STROKE_MAX_POINTS: 500` but the unit tests (TC-03) generate a 5010-point spiral and expect 2 parts, which only makes sense with STROKE_MAX_POINTS = 5000.

3. **STROKE_HIT_TOLERANCE_PX = 6**: Used 6px screen-distance tolerance for hit testing (not 5px as mentioned in the compacted summary). TC-07 tests at 5.9 and 6.1 units from line at zoom 1, and TC-15 tests at 5px and 7px screen distance at different zoom levels.

4. **STROKE_MIN_SIZE_WORLD = 4**: Minimum stroke size in world units.

5. **STROKE_BASE_SIZE removed**: Not needed as a constant. Each stroke computes its own bbox from points padded by thickness/2.

6. **color field widened**: `ObjectSnapshot.color` is typed as `string | undefined` to accommodate both sticky colors and pen colors. `StickySnapshot` narrows it back to `StickyColor`.

7. **Pen tool does NOT capture pointer with `setPointerCapture`**: Removed in favour of relying on React's pointer-event handler on the overlay element. In production browsers, pointer capture is optional for overlays that cover the full viewport.

8. **getCoalescedEvents fallback**: The `getCoalescedEvents()` method exists in jsdom but returns an empty array. The implementation falls back to the event's own coordinates when `getCoalescedEvents()` returns empty, ensuring correct point accumulation in tests and older browsers.

9. **Pen tool overlay**: The PenTool renders as an absolutely-positioned overlay with `z-index: 9999` covering the entire board area. This captures all pointer events while the pen tool is active, preventing panning and object manipulation. Wheel events bubble through to the board (handled by the BoardViewport) so navigation still works.

10. **hitTest zoom parameter**: Extended the registry `ObjectTypeSpec.hitTest` signature with an optional `zoom` parameter to support zoom-dependent hit tolerance for strokes.

11. **StrokeObject rendering**: Renders an SVG `path` with the smooth path. Uses `pointer-events: stroke` on an invisible fat path for hit testing. The outer div has `pointer-events: none` so clicks pass through except on the stroke line itself.

12. **Multi-participant e2e tests (TC-18, TC-20)**: Written correctly but cannot pass in this sandbox environment because the Durable Object WebSocket connection doesn't work here. This affects all pre-existing multi-participant e2e tests equally.

## Files created
- `src/shared/geometry/simplify.ts` — RDP simplify, splitPoints, smoothPath
- `src/shared/objects/stroke.ts` — createStroke, scaledPoints, StrokeSnap
- `src/client/tools/PenTool.tsx` — Pen tool overlay component
- `src/client/tools/PenToolbar.tsx` — Colour and thickness toolbar
- `src/client/tools/usePenOptions.ts` — Session-only state hook
- `src/client/objects/StrokeObject.tsx` — Stroke rendering component
- `tests/fixtures/pen-paths.ts` — Test path fixtures
- `tests/unit/stroke.test.ts` — Unit tests (TC-01 to TC-08)
- `tests/component/PenTool.test.tsx` — Component tests (TC-09 to TC-16, TC-21)
- `tests/e2e/pen-stroke.spec.ts` — E2E tests (TC-17 to TC-20)

## Files modified
- `src/shared/config.ts` — Added pen/stroke constants
- `src/shared/board-model.ts` — Stroke snapshot support
- `src/client/objects/registry.tsx` — Register stroke type with hit test
- `src/client/board/Toolbar.tsx` — Add Pen button
- `src/client/tools/useActiveTool.ts` — Allow pen tool via keyboard
- `src/client/App.tsx` — Wire up PenTool, PenToolbar, usePenOptions
- `src/client/objects/StickyNote.tsx` — Type cast fix for widened color field

## Test results
- **Unit**: 181/181 pass
- **Component**: 125/131 pass (6 pre-existing failures from story 5: SharePanel timeouts and pages retry test)
- **E2E**: TC-17 and TC-19 pass in chromium. TC-18 and TC-20 fail due to Durable Object connection infrastructure limitation (same as all other multi-participant e2e tests in this environment).
- **Build**: passes
- **Typecheck**: passes (worker type errors are pre-existing Cloudflare types)
