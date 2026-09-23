# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write stroke model and geometry unit tests first (TC-01 to TC-08) | proposed | test:unit | stroke.model |
| 2 | Implement stroke model: RDP simplify, split, smooth path, createStroke, scaled points | proposed | implementation | stroke.model |
| 3 | Implement Pen tool: capture, local preview, commit on finish/cancel/limit, options toolbar, viewport routing | proposed | implementation | pen.tool |
| 4 | Implement StrokeObject rendering and registry entry with line-distance hit test and aspect-locked resize | proposed | implementation | stroke.object |
| 5 | Component tests for Pen tool and StrokeObject (TC-09 to TC-16, TC-21) | proposed | test:ui-component | pen.tool, stroke.object |
| 6 | E2E pen workflows: annotate, shared sketch, tidy up (TC-17 to TC-20) | proposed | test:e2e | pen.tool, stroke.object |

## Details

### 1. Write stroke model and geometry unit tests first (TC-01 to TC-08)

## Goal
Test-first suite for the stroke.model contract (`simplify`, `splitPoints`, `smoothPath`, `createStroke`, `scaledPoints`, plus `distanceToPolyline` from story 10 applied to scaled points) with a real Y.Doc; add PEN_COLORS, PEN_THICKNESS_WORLD, DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD and stub exports.

## Fixtures
`tests/fixtures/pen-paths.ts`: recorded handwritten loop (~400 jittery points), underline (~120 points), synthetic 5,010-point spiral.

## Cases
- TC-01 simplify loop at tolerance 1 → every raw point within 1 unit of result, fewer points.
- TC-02 tolerance 0.5 (zoom 200%) → every raw point within 0.5.
- TC-03 splitPoints at STROKE_MAX_POINTS − 1 / exactly / + 1 → 1 / 1 / 2 parts; part 2 starts with part 1's last point (boundary).
- TC-04 createStroke single point thick → bbox = thickness square, points length 2 (dot).
- TC-05 empty points, NaN point, colour 'pink', thickness 'huge' → null, zero update events (negative, error paths).
- TC-06 scaledPoints after width and height doubled → coordinates doubled, thickness unchanged (proportional resize).
- TC-07 distanceToPolyline(scaledPoints) at 0 / 5.9 / 6.1 units → within / within / outside STROKE_HIT_TOLERANCE_PX at zoom 1.
- TC-08 smoothPath of 3 points → deterministic string starting with M and using Q segments.

## Done when
Suite compiles and fails only with "not implemented".

### 2. Implement stroke model: RDP simplify, split, smooth path, createStroke, scaled points

## Goal
Implement stroke.model per contract so TC-01..TC-08 pass.

## Approach
- `simplify`: iterative Ramer–Douglas–Peucker (explicit stack, no recursion depth risk on 5,000 points), keeps first/last, guarantees max deviation ≤ tolerance (smoothing faithfulness).
- `splitPoints`: chunks of STROKE_MAX_POINTS sharing the join point.
- `smoothPath`: `M p0` then `Q p[i] mid(p[i], p[i+1])` segments, ending at the last point; single point → zero-length path for a round dot.
- `createStroke`: validate points (non-empty, finite), colour and thickness names → else null with no transaction; compute bbox padded by thickness/2 (dot: thickness square); store flattened points relative to bbox origin plus baseWidth/baseHeight; z = maxZ+1; one LOCAL_ORIGIN transaction.
- `scaledPoints`: multiply by width/baseWidth and height/baseHeight; thickness unchanged.
- `snapshot()` emits `StrokeSnap` for `type: 'stroke'`.

## Done when
All stroke unit tests pass; typecheck passes.

### 3. Implement Pen tool: capture, local preview, commit on finish/cancel/limit, options toolbar, viewport routing

## Goal
Implement pen.tool per contract.

## Approach
- `usePenOptions`: session React state, defaults DEFAULT_PEN_COLOR / DEFAULT_PEN_THICKNESS; not persisted.
- `PenToolbar`: `button[aria-label="<colour> pen"][aria-pressed]` × 6 and Thin/Medium/Thick buttons; visible only while tool is `pen`. Changing options never touches existing strokes.
- `PenTool`: on pointerdown capture pointer, record world points (using `getCoalescedEvents()` when available), draw a screen-space SVG preview once per animation frame; preview is never written to the Y.Doc, so others don't see in-progress strokes.
  - At STROKE_MAX_POINTS raw points: simplify + `createStroke` the part, restart from its last point.
  - pointerup: movement < DRAG_THRESHOLD_PX → single-point dot; else `simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom)` then `createStroke`.
  - pointercancel / lostpointercapture: finish with points so far.
  - null result → clear preview silently.
  - After each commit `undoManager.stopCapturing()`; tool stays `pen`; Escape or another shortcut switches tool.
- `BoardViewport` modification: while tool is `pen`, pointerdown (including over objects) routes to PenTool and does not pan or start object drags; wheel/pinch unchanged so scrolling pans and Ctrl/Cmd+scroll zooms.
- `useActiveTool`: add `pen` (P) and Pen toolbar button; round cursor sized thickness × zoom.

## Done when
TC-09..TC-14 and e2e TC-17..TC-19 pass.

### 4. Implement StrokeObject rendering and registry entry with line-distance hit test and aspect-locked resize

## Goal
Implement stroke.object per contract.

## Approach
- `StrokeObject`: SVG `path` with `d = smoothPath(scaledPoints(stroke))`, round caps/joins, `stroke-width` = PEN_THICKNESS_WORLD[thickness], colour from PEN_COLORS, `fill="none"`, `aria-label="Drawing"`; renders identically for remote strokes as soon as the snapshot updates.
- Registry `stroke`: `{ Component: StrokeObject, resizable: true, aspectLocked: true, minSize: STROKE_MIN_SIZE_WORLD, editableText: false, hitTest: distanceToPolyline(scaledPoints(s), p) <= max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom) }` so clicks inside the bbox but away from the line fall through to objects below.
- Proportional resize comes from story 7 handles honouring `aspectLocked` plus `scaledPoints`; thickness is not scaled.
- If a selected stroke is deleted remotely, story 7 stale-id handling clears selection; nothing to do here beyond not throwing on a missing snapshot entry.

## Done when
TC-15, TC-16, TC-21 and e2e TC-20 pass.

### 5. Component tests for Pen tool and StrokeObject (TC-09 to TC-16, TC-21)

## Goal
jsdom tests (real Y.Doc, synthetic pointer events, fake rAF timers) for pen.tool (PenTool gesture states, PenToolbar options, tool staying active) and stroke.object (registry hit test, fall-through selection, stale selection).

## pen.tool
- TC-09 with red + thick selected, pointerdown/moves/up → `createStroke` once with red/thick; tool still `pen`.
- TC-10 pointerdown/up without movement → single-point dot committed.
- TC-11 pointerdown, moves, pointercancel → stroke committed with points so far (interrupted).
- TC-12 STROKE_MAX_POINTS + 10 moves → two commits, second starts at the first's last point (boundary).
- TC-13 Escape; pressing V → tool `select`, nothing created (negative).
- TC-14 change colour after a stroke exists → existing stroke unchanged; next stroke uses new colour (negative).

## stroke.object
- TC-15 registry hitTest at 5 px and 7 px screen distance at 50% and 200% zoom → hit / miss (boundary).
- TC-16 click inside a stroke's bbox far from the line over a sticky note → sticky selected, stroke not (negative).
- TC-21 stroke deleted via model while selected → selection cleared, no exception (error path).

## Done when
All pass in `npm run test:component`.

### 6. E2E pen workflows: annotate, shared sketch, tidy up (TC-17 to TC-20)

## Goal
Real-browser proof for pen.tool (preview during drag updated every animation frame, share-on-finish, navigation and object routing while Pen is active) and stroke.object (select by line, proportional resize, move, delete across participants) against `wrangler dev`, using the recorded paths in `tests/fixtures/pen-paths.ts`.

## Workflows
- "Annotate a cluster": TC-17 real drag replaying the handwritten-loop fixture → preview `path` element exists during the drag and its `d` attribute changes on consecutive animation frames (sampled with `requestAnimationFrame` in the page), stroke persists after release; TC-19 wheel while Pen active pans the board, then a drag starting on a sticky creates a stroke and leaves the sticky in place (negative: no pan/move).
- "Shared sketch": TC-18 Priya draws while Sam watches → Sam sees nothing during the drag (negative) and the stroke within LIVE_UPDATE_LATENCY_BUDGET_MS after release.
- "Tidy up": TC-20 press V, click the stroke line, drag a corner handle (aspect ratio preserved within 1%, thickness unchanged), drag body to move, press Delete → removed on both screens.

## Explicitly not asserted (per strategy "Not covered")
Drawing latency on low-end hardware and simplification compression ratio are manual checks recorded in the PR description, not CI assertions.

## Done when
All pass in chromium; TC-17 also in firefox and webkit.

