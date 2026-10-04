# Notes: decisions, workarounds and deviations

## Story 11 — Sketch freehand with a pen

**Naming: `StrokeSnapshot`, not `StrokeSnap`.** design.md's contract sketch writes
`StrokeSnap`; the codebase has never used that shorthand in code — the stored names are
`ShapeSnapshot` and `ConnectorSnapshot`. Consistency inside the repository wins, so the
interface is `StrokeSnapshot` (`src/shared/objects/stroke.ts`) and everything else in the
design's contract — `createStroke`, `scaledPoints`, the fields, the setting names — is as
written.

**`scaledPoints` answers in the box's own space.** The design's one-line hit test
(`distanceToPolyline(scaledPoints(s), p) <= …`) reads as though those points were world
points, but task 1's test TC-06 pins the opposite: after a resize that doubles `width`
and `height`, `scaledPoints`' *coordinates* double — which is only true of points
measured from the box's origin (world coordinates would not double, since the box has not
moved). So `scaledPoints` returns box-relative points, and the registry's hit test does
the one subtraction that makes the design's line correct:
`distanceToPolyline(scaledPoints(s), { x: p.x - s.x, y: p.y - s.y })`. Rendering wants
the same answer for the same reason: the stroke's `<svg>` sits at the box with a
`viewBox` of its own size, so it draws in that space.

**"snapshot() emits StrokeSnap" is the general read path, not `snapshot()`.**
`snapshot()` in board-model returns only sticky notes, and story 9 and 10 both left it
that way on purpose (their objects are asked for by name, through `objectSnapshots()`);
changing it would mean every earlier reader handling types it has no use for. Story 11
follows the precedent: `readSnapshot` dispatches `type === 'stroke'` to
`strokeSnapshotOf`, `objectSnapshots()` therefore carries `StrokeSnapshot`s, and
`readStrokes(doc)` is the named read. `snapshot()` is untouched.

**Refusing a stroke, and what "invalid input" means.** `createStroke` returns null with
no transaction for: no points; any point whose `x`/`y` is not finite; a colour or a weight
that is not one of the six/three. A path with *one* broken point is refused whole rather
than truncated — the design's "a rejected stroke clears the preview silently" is about the
gesture being dropped, and a sketch missing a third of itself is a worse outcome than no
sketch at all. Non-finite input is reached only by a bug or a hand-edited document, so the
reader is permissive where the writer is strict: `strokeSnapshotOf` reads garbage points as
an empty path and an unknown colour/weight as the default, so the board still draws.

**The dot is padding, not a special case.** The stored box is the points' bounds padded by
half the pen's thickness on every side, so one point lands in a square of exactly the
thickness and the round-capped zero-length path inside it (`M x y L x y`) is the dot. The
same padding is why a stroke resized to fill the viewport is never clipped: the ink strays
half its width either side of the line, and that much is in the box.

**`simplify` is iterative, and its guarantee is stated in its own file.** Ramer–
Douglas–Peucker written recursively on a 5,000-point path that hardly deviates is 5,000
stack frames, which is the first long stroke anybody draws; the implementation carries its
own stack of spans. It splits a span only when the furthest point is *strictly* past the
tolerance, so everything dropped is within it — that is PRD pen.smooth, and TC-01/TC-02
assert it over all 400 points of a jittery fixture rather than over a picture. A tolerance
that is not a positive number means "keep everything the hand did", which is still
faithful.

**Smoothing keeps the line where it was, by construction.** `smoothPath` puts a quadratic
curve through the midpoints of the simplifier's segments, steering by each recorded point.
A quadratic curve never leaves the triangle of its three points, so it stays within half a
segment of the polyline RDP certified — which is what lets one tolerance cover both steps.

**The palette is a closed set, as in stories 9 and 10.** The colour and weight are
validated against `PEN_COLORS` / `PEN_THICKNESS_WORLD` on the way in and sanitised on the
way out, so a document can never hold a style the board cannot draw. Both type names come
from `config.ts` (`keyof typeof`), re-exported from `stroke.ts` the way `shape.ts`
re-exports `ShapeKind`.

## Task 3 — the Pen tool, and where its layer lives

**The pen's layer is a child of the board surface, not a neighbour of it.** Every earlier
tool layer (`ShapeTool`, `ConnectorTool`) is a `position: fixed` sibling rendered after
`BoardViewport`, and for the pen that would have been wrong: the surface owns the wheel
and `gesture*` listeners, so a fixed layer above it would swallow every wheel that landed
on the drawing area, and "the board still pans and zooms while the pen is held" (PRD
`pen.navigation`) would have meant re-implementing story 1 inside the pen. `BoardViewport`
therefore grew one prop, `screenOverlay`, rendered inside the surface after the world
layer: the pen's own pointer handlers stop propagation, so no drag reaches the board,
while a wheel *does* bubble — to the surface's own non-passive listener, unchanged. The
prop is deliberately generic (screen-pinned layer, above the world, below the rails) and
the pen is its first user.

**An interrupted gesture commits; a changed mind discards.** design.md says both: its
state machine and its coverage table (TC-11) say `pointercancel` /
`lostpointercapture` commit the points so far, while one sentence elsewhere says the
preview is thrown away. Two of the three — including the table that the tests are derived
from — say keep, and PRD `pen.interrupted` agrees, so those two events finish the stroke.
Escape and choosing another tool are the discard, implemented by the layer unmounting: the
points live in refs inside it, so nothing survives. `finish` returns early if the gesture
has already ended, which is why a real release (pointerup, then lostpointercapture)
commits exactly once.

**Recorded in board units, drawn in screen pixels.** Pointer positions — including every
`getCoalescedEvents()` entry, wrapped in try/catch because synthetic events in tests do
not have the method — are converted to board points as they arrive, and the preview path
is rebuilt from those through the *current* camera once per animation frame (a rAF loop
that runs only while a stroke is in hand, and only repaints when a move has arrived). So
a stroke drawn at 400% is the same object at 100%, and a pan mid-drag cannot distort it.
`getCoalescedEvents` is why a 250 Hz stylus does not draw a cornered version of a smooth
line.

**The commit tolerance is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` at the moment of
finishing**, and one stroke is one transaction with `undo.boundary()` on both sides of it,
mirroring `ShapeTool`. A path the model refuses returns null and the preview is simply
gone — no alert, no half-drawn line.

**A click is a dot, using the board's own threshold.** Below `DRAG_THRESHOLD_PX` (3 screen
pixels, the same number story 7 uses to tell a click from a drag) the release commits the
single starting point rather than the 2–3 points of a click's jitter.

**The pen is not put back after a stroke** (PRD `pen.stay_active`): unlike shape, text and
sticky, nothing in the pen's path calls `toolCreated`, and `useActiveTool` documents that
exception on purpose. Its two choices are session state (`usePenOptions`), like the shape
kind: they are not written to the board, so a colour is not something two people have to
agree about, and a reload starts from `DEFAULT_PEN_COLOR` / `DEFAULT_PEN_THICKNESS`.

**The cursor is a ring, hidden until the pointer is seen**, sized
`PEN_THICKNESS_WORLD[thickness] * zoom` with a floor (`PEN_MIN_CURSOR_PX`, 5 px) so a thin
pen at 20% zoom is still visible; it is written by direct style mutation, not state, so
pointer moves do not re-render. `cursor: none` on the layer makes it the cursor. Two
pointers during one stroke: the second is ignored, the first line goes on.

**z-index**: the pen layer is at 15, like the other tool layers — under the rails (20), so
the toolbar and the pen options are always reachable. Like the shape and connector tools,
it therefore covers the zoom controls at the bottom right while held; that is already the
board's behaviour for the other two tools and changing it is outside this story.

## Task 4 — StrokeObject, and what a press is allowed to find

**The ink is decoration; an invisible copy is the target.** Like `ConnectorObject`, the
drawn `<path>` takes no pointer events and a second path with `pointer-events: stroke`
does, `stroke-width` = `2 × max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)`, so the
shape you can hit and the registry's `hitTest` are the same number. Its handler converts
the press to board units and re-checks `distanceToPolyline`, and returns without selecting
when the press is inside the box but away from the line — which lets the press fall to a
note underneath (PRD `pen.select`, TC-16).

**Caps, joins and `fill` are attributes on the path, not stylesheet rules.** The design
names them as attributes, an e2e test can read an attribute without depending on the
stylesheet, and `fill="none"` in particular must not be forgotten when the path is closed
by hand. The stylesheet keeps only what is not about drawing (`pointer-events`, cursor).

**Weight does not scale; length does.** `scaledPoints` scales the stored points by
`width / baseWidth`, and `stroke-width` stays `PEN_THICKNESS_WORLD[thickness]`, so a
doubled sketch is a longer line of the same thickness (PRD `pen.resize`).
`aspectLocked: true` is what keeps the ratio honest; the registry's `handles` field has no
"corners only" value in this codebase (`'all' | 'horizontal'`), so handles are the default
`'all'`, which is the proportional case.

## Task 5 — component tests

**Two fakes worth admitting.** jsdom has no PointerEvent, so the harness dispatches
MouseEvents named `pointer*` (as stories 1–10 already do), and it has no coalescing, so
`fireBatch` defines `getCoalescedEvents()` on the event it dispatches — returning objects
with `clientX`/`clientY`, which is what a browser's are. TC-12 (the 5,000-point limit) is
unreachable in reasonable time without that: 5,010 points arrive ten batches per event.

**Points are compared in world units.** A snapshot's points are box-relative, so two
strokes that meet are equal only after their boxes' origins are added back
(`worldPoints` in the harness); the first assertion written here compared local coordinates
and was wrong, which is a decent argument for that helper existing.

**Stale selection (TC-21)** is driven the way it happens: select the line by pressing it,
delete the object through the model, then check the selection is empty, the element is
gone, and the next Delete key finds nothing — i.e. the board is still answering.

## Task 6 — end to end

**Five cases, all of them real pointer gestures.** `tests/e2e/sketch.spec.ts`: TC-17 the
loop, previewed frame by frame and arriving finished; TC-17b the ring and the stroke it
promises; TC-18 the watcher who sees nothing until the pen is lifted; TC-19 the wheel and
the note under the pen; TC-20 select, resize, move, delete, on two screens. Fixture paths
from `tests/fixtures/pen-paths.ts` are replayed one point per `mouse.move`: `steps` would
interpolate inside the browser and hide a tool that sampled only the ends.

**Board units are not window pixels, and this is measured, not assumed.** The camera maps
world 0,0 to the *surface's* top-left, so `surfaceOrigin`/`toScreen` shift a fixture path
before it reaches the mouse, and the drawn box is compared against `origin + box`. Story 10's
spec gets away without this because it compares screen with screen; a stroke test compares
the document's coordinates with the screen's, and that difference is the whole claim.

**The frame claim needs a sampler on the page's side of the wire.** Playwright's round trips
are milliseconds and a frame is sixteenths of one, so asking from outside would see one
static picture after another and prove nothing. `startPreviewSampler` records the preview
path's `d` on every `requestAnimationFrame` while the mouse is being dragged, and the test
asserts on what came back. The strictest reading of "changes on every frame" cannot be
asserted on a machine shared with the model and the server — a frame in which no pointer
event happened legitimately holds still — so the assertion is: at least five frames, at
least three distinct paths, the last different from the first, and at least a quarter of
consecutive frame pairs changed. On this host a 134-point drag yields ~20 frames and most
of them differ.

**TC-19's wheel is the real test of the `screenOverlay` decision.** The pen layer covers the
whole board; a wheel moved over it has the layer as its target. In a real browser it bubbles
to the surface's own non-passive listener and the board pans by the scroll delta — asserted
by measuring a note's screen box before and after — so story 1's navigation is unchanged
rather than re-implemented. The second half of the case is the other half of the rule: a drag
that starts in the middle of a note draws a line and leaves the note's document coordinates
and screen size exactly where they were.

**"No note toolbar" has to be earned.** Creating a note leaves it selected, so the case
clicks empty board with the select tool first. Otherwise the assertion that the pen's drag
did not select the note would pass for the wrong reason.

**A negative is checked twice, with the latency of an update in between.** For TC-18 Sam's
screen is asserted empty, then again after 200 ms, because "nobody is watching" is only the
same claim as "nobody saw it" if a frame budget has passed for something to arrive. The
finished stroke's arrival is timed with `changeArrives`, which logs against
`LIVE_UPDATE_LATENCY_BUDGET_MS` rather than asserting on it; both screens are then compared
field by field (`toEqual`), since a stroke that arrives changed is a bug no drawing test
would find.

**`boxOf`, once.** The shared `ObjectSnapshot` allows `width`/`height` to be missing because
free text has none, so arithmetic on a sketch's box would need `!` fourteen times. One
narrowing helper in the spec, with the reason next to it, is cheaper and louder.

**This host cannot start Firefox or WebKit** (missing system libraries; Playwright's own
probe in `playwright.config.ts` says so and skips them). No case in the file is gated on a
project, so all five run wherever those browsers exist: TC-17 and TC-17b are the two that
would actually catch a browser-specific path problem, being the ones that read frames and
rendered attributes. Chromium: 5/5, and 15/15 over `--repeat-each=3`. Full suite: 68 passed.
