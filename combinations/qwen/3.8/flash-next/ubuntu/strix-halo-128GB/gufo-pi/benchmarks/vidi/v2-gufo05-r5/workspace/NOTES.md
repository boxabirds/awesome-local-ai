# Story 5 Implementation Notes

Decisions and deviations from the spec/design that future readers should know:

## Server-side

1. **`existsReadOnly()` reads `storage_meta` for `created_at` OR checks for `updates` table rows.**
   The design says "the board exists iff `storage_meta` has a `created_at` row OR the room has
   `updates` rows". Reading a single indexed key from the DO's SQLite is synchronous and cheap.
   No caching layer added: the design explicitly warns against it.

2. **`BoardStore.load()` treats "no tables" as a valid empty board.**
   When the DO is instantiated by a GET or an upgrade to an unknown board, the tables don't exist
   yet. `load()` checks `sqlite_master` for the `updates` table; absent → the board is empty (ok:true)
   rather than quarantined. This avoids a migration-on-construct (which would violate TC-06/TC-09).

3. **`migrate()` only runs inside `initialize()` or lazily before the first `append()`.**
   Removed from `BoardRoom.#load()` (story 4 ran it on construct). A board that was never
   `initialize()`d and receives an upgrade gets a 404, so `#load()` never runs on a board with
   no tables.

4. **RPC methods `initialize()` and `exists()` use Cloudflare's DO RPC pattern (async methods on the
   DO class called directly on the stub).** This requires `compatibility_date >= 2024-09-23`;
   the current config already uses `2026-08-01`.

5. **`/api/rooms/:id` with a malformed id returns 404 (was 400 in story 4).**
   TC-13 requires not distinguishing "malformed" from "unknown". The design documents this change.

6. **`POST /api/boards` generates one id via `newUniqueId()` + `initialize()`.**
   No retry loop on collision: the design says "a collision means the id is already in use, and
   the board we want exists." One attempt is the whole logic.

## Client-side

7. **Router uses `window.history.pushState` + manual `PopStateEvent` dispatch.**
   `pushState` doesn't fire `popstate` natively, so `navigate()` dispatches it manually so the React
   hook picks up the change. The hook subscribes to `popstate` which also catches browser
   back/forward.

8. **`BoardPage` shows a "checking" state briefly before rendering the board.**
   The existence check is async (fetch), so the first render is the loading text. The state resolves
   after one round-trip. For board IDs that match the pattern, it calls `checkBoard()`. For
   malformed IDs, it renders NotFound immediately (no request).

9. **SharePanel uses `position: fixed` with z-index 100/101.**
   The board viewport captures all pointer events; the Share button and panel must be above it
   (same pattern as the toolbar and zoom controls).

10. **`<meta name="referrer" content="no-referrer" />` is in the Vite HTML template.**
    Vite's build preserves it in `dist/client/index.html`. The integration test checks for the tag
    without the trailing `/` since Vite normalizes self-closing meta tags.

## E2E test infrastructure

11. **Added `POST /__test/boards/:id/init` test hook.**
    E2E seeding helpers need to initialize a board with a specific id before connecting via
    WebSocket (the existence gate). The `init` action calls `stub.initialize()` RPC. Gated behind
    `TEST_HOOKS=1` like all other hooks.

12. **`ensureBoardOnServer()` helper added to seed-board.ts.**
    Called by `openParticipants`, `seedBoard` callers, and the persistence tests to initialize
    boards before first connection.

13. **`storage-hooks-off.spec.ts` uses `POST /api/boards` instead of `newBoardId()` + seedBoard**
    for the board that needs to exist on a server without TEST_HOOKS. The POST endpoint is a
    production route, not gated.

14. **`navigateToNewBoard()` helper replaces `page.goto('/')` in existing e2e specs.**
    Story 5 changes `/` to be the home page. Tests that need a board now POST to create one,
    then navigate to `/b/:id`.

---

# Story 8 Implementation Notes

Undo/redo of a person's own changes only. What the design said, what was built, and the places where
the built thing is deliberately different.

## Deviations from design.md

1. **The controller is created in `useBoardDoc`, not in `App.tsx`.**
   `App.tsx` never holds the board document, so it cannot own a controller over it. `useBoardDoc`
   already owns the document's lifecycle (one `Y.Doc` per board id), so `createUndo` runs beside it
   and the retired doc/controller pair is destroyed in the effect that follows the switch. Net
   behaviour is what the design asks for: one controller per board document, destroyed on board
   change and on unmount, so history is session-only (TC-11).

2. **`useUndo` returns `boundary()` and `controller` as well as `canUndo`/`canRedo`/`undo`/`redo`.**
   `Board.tsx` needs `boundary` for gestures, key commands and creates, and passes `controller`
   down to `StickyNote`/`StickyTextEditor`, which need the controller itself, not the flags.

3. **`Ctrl+Y` is redo** (`useBoardKeys` and the note editor both). The PRD names it alongside
   Ctrl/Cmd+Shift+Z.

4. **The e2e fixture for TC-22 is the seeded board, not 8 notes the tester made.**
   `seedBoard(..., 12)` writes 12 notes in all six colours, most with text, before anybody opens the
   board. Those notes arrive over the provider, so they are in nobody's history: Mia's delete is her
   own change, and undoing it brings the fixture back exactly. This also proves story 4's load
   updates are not undoable at the level of a real browser, which the design only asked of a unit
   test (TC-03).

5. **`useTransformGesture` raises the dragged note *after* the step boundary, not before.**
   The move gesture used to call `bringObjectsToFront` first and `onGestureStart` second. With undo
   wired up, that put the z-write inside the *previous* step, so one undo could un-raise a note
   without moving it. One step now covers the raise and the move, which is what "my move" means.

## Facts about yjs that shaped the tests

6. **An undo whose target a colleague deleted can consume more than one own step.**
   `Y.UndoManager.popStackItem` keeps popping until a change actually lands. Undoing my move of a
   note Raj deleted therefore also eats the next step of mine (usually the create, which is a no-op
   because the note is gone). PRD says "nothing visible happens"; yjs gives "nothing visible happens
   from that step, and one more of my own steps is spent". Reimplementing struct-level pre-checks to
   save the extra step was judged not worth it - TC-07 and TC-23 assert the user-visible guarantees
   (no error, delete wins, history still usable) rather than an exact step count.

7. **Fake timers cannot move yjs's clock.** `lib0/time.js` does `export const getUnixTime = Date.now`,
   captured by reference at module load; `vi.useFakeTimers()` replaces `globalThis.Date` but the
   captured reference still points at the real `Date.now`. TC-13 therefore runs on real time, with
   margins of 250 ms around `UNDO_CAPTURE_TIMEOUT_MS` instead of the exact 1 ms the design suggested.

8. **Two text inserts by the same client can merge into one `Item` struct**, so "undo the last
   character" can remove several characters. Tests that count steps precisely use map-key writes
   (`setStickyColor`), not text.

9. **`StackItem.insertions`/`deletions` are `DeleteSet`s**, not sets of keys: `deleteSet.clients` is a
   `Map<client, Array<{clock, len}>>`. Nothing in the controller needs to read them; trimming works
   on `undoStack` directly.

## Small things worth knowing

10. **Trimming uses `undoStack.splice(0, excess)`.** Dropped items are not passed through
    `Y.UndoManager`'s own `clearStackItem`, so their `changed` structs stay referenced until the
    controller is destroyed. That costs memory (bounded by 200 dropped steps), never correctness.

11. **The Undo/Redo buttons live in the existing left `.board-toolbar`**, below a divider, reusing
    `.board-toolbar__button`, with `data-testid="undo-button"` / `"redo-button"` and `aria-label`
    plus a tooltip that names the shortcut. Disabled state sets both `disabled` and `aria-disabled`.

12. **`useUndo`'s return value is memoised.** `useBoardKeys` keeps it in an effect dependency list;
    without memoisation the window `keydown` listener would be torn down and re-added on every
    render of the board.

13. **Inside a note editor, Ctrl/Cmd+Z keeps the caret and the focus.** The editor does not clear the
    selection (which would unmount it); the ytext observer fires because the undo transaction's
    origin is the UndoManager and not `LOCAL_ORIGIN`, so the textarea value and caret follow the
    shared text.

14. **Firefox and WebKit still cannot launch on this machine** (missing system libraries), so story
    8's e2e ran on Chromium; the config skips those projects with a warning rather than failing.

---

# Story 9 Implementation Notes

Free text anywhere on the board. What the design asked for, what was built, and the places where the
built thing is deliberately different.

## Deviations from design.md

1. **The size toolbar renders inside `TextObject`, not in `SelectionBar`.**
   The design's file table puts the S/M/L/XL picker in `SelectionBar`. The note's toolbar
   (`NoteToolbar`) hangs off the note itself, and a heading's size belongs to the heading: anchoring
   the picker to the object keeps it over the thing it changes while a multi-select bar stays about
   the group (count, delete). `SelectionBar` is unchanged, and a selected text shows its toolbar the
   same way a selected note shows its colours.

2. **A box that cannot hold the words it was drawn with grows (design has only "the writer
   measures").**
   `useTextBoxSync` keeps the design's rule exactly - a change arriving from anyone else never causes
   a measurement or a write here. What it could not anticipate is that two people typing into one
   `Y.Text` merge into a shape *neither* of them measured, so both screens hold a box too short for
   the text both now show, and the annotation is cut off. So the screen that drew the words checks
   what it drew (`TextObject`'s fit check) and calls `growTextBox`, under three rules that keep the
   one-writer property: only values *smaller* than the measurement are written (a box can grow and
   never shrink, so browsers with different fonts converge instead of arguing), a `fixed` width is
   never widened (that width is a person's decision and the words wrap inside it), and the write
   carries `BOX_ORIGIN` rather than `LOCAL_ORIGIN`, so it syncs to everybody but is not an undo step
   - undo can therefore never cut text off again. The check also runs when `document.fonts.ready`
   settles, because a webfont arriving after the first paint rewraps everything with nothing else
   happening.

3. **`LOCAL_ORIGIN` (and now `BOX_ORIGIN`) live in `src/shared/y-origin.ts`.**
   `objects/text.ts` has to mark its own transactions and must not import the document model to get
   the symbol - `board-model` reads the object modules, not the other way round. `board-model`
   re-exports `LOCAL_ORIGIN`, so every existing caller is unchanged.

4. **`TextSnapshot` is a standalone interface, and `snapshot()` returns every object type.**
   `ObjectSnapshot` is a union, and an interface cannot extend a union, so the text shape is spelled
   out. Making `snapshot()` type-agnostic would have changed what the note tests read, so
   `snapshot()` now returns all objects while `stickySnapshot()` filters to notes: existing
   semantics stay, generic code (selection, marquee, registry) reads `snapshot()`.

5. **`Board.tsx` renders objects through the registry, and knows no type name.**
   `objects.map(object => getObjectType(object.type)?.Component)` with unknown types skipped. This is
   the smallest change that adds text without a second rendering path, and it is what makes the next
   object type a registration rather than an edit of the board.

6. **The Text tool intercepts pointers on the viewport node, in the capture phase.**
   Board objects `stopPropagation()` on pointerdown - correctly, or clicking a note would pan the
   board - so a React handler on a parent would never hear the click that is meant to place text. The
   tool's listener is a native capture-phase listener on the viewport element, and it stops
   propagation itself. It also lays down a short guard (`TEXT_TOOL_DOUBLE_CLICK_GUARD_MS` / `_PX`):
   the second click of a double-click that began as "place a text" must not be read by the sticky
   note tool as "make a note here".

7. **`createdBy` is the placeholder `'local'`.**
   Story 6 (identity) is not implemented; the field is written and read, and the author of a text is
   whatever the board was told. Nothing in story 9 depends on whose it is.

## Facts about text and CSS that shaped the tests

8. **`.board-text` is `box-sizing: content-box`, on purpose.**
   Then the inline `width`/`height` the model stores *is* the area `layoutText` measured, and the CSS
   padding sits outside it - the selection outline therefore has headroom around the letters, and a
   line the maths says fits never wraps in the browser. A test (`text.object.styles`) reads
   `styles.css` and asserts the four numbers the drawing uses - `box-sizing`, the padding,
   `font-family`, `line-height` - equal the constants the measurement uses, because those two halves
   of the story agree only if somebody checks.

9. **Auto width is `min(longest line + padding, TEXT_MAX_AUTO_WIDTH_WORLD)`, and the text area is
   `width - TEXT_BOX_PADDING_WORLD` - one padding, not two.**
   The one padding is the right-hand headroom that keeps a line the measure called "fitting" from
   being broken by subpixel rounding. A 300-character sentence therefore lands on a box exactly
   600 units wide, and the e2e measures the browser's own wrapping to check the stored height holds
   it (`textIsWhole` compares `scrollHeight` with `clientHeight` - the assertion that nobody's words
   are cut off).

10. **A word wider than the box: the layout leaves it whole, the browser breaks it, and the height
    absorbs the difference.**
    `layoutText` never rewrites what a person typed and gives such a word its own line (unit-tested,
    including that it terminates). `.board-text__content` has `overflow-wrap: break-word`, so the
    browser splits it instead - which would make the drawn text taller than the stored box if nothing
    noticed. It is noticed, by the fit check in note 2. This is visible at `TEXT_MIN_WIDTH_WORLD`,
    where almost any word is too wide, which is where the e2e checks it.

11. **Undo steps are cut by boundaries, not by time alone.**
    Placing a text ends with `boundary()`; the editor calls `boundary()` when it mounts and again
    when it unmounts. Typing and the boxes it writes are therefore one step, separate from the
    placement (TC-25: one undo leaves the text where it was placed - empty, at `TEXT_MIN_WIDTH_WORLD`
    - and redo brings the words and their box back together).

12. **`setTextBox` writes only the keys that differ**, so a remeasure that found nothing changed puts
    nothing on the wire (TC-13), and the tests can say which key a gesture was responsible for: a
    side-handle drag writes `width` + `widthMode`, and the box sync answers with `height` alone.

## Small things worth knowing

13. **One canvas measures everything.** `useTextBoxSync` takes a measurer argument (the component
    tests inject a fake) and defaults to a module-level `createCanvasMeasurer()` made on first use.
    Where there is no canvas - jsdom - it falls back to the character estimate once, the same way a
    browser without `measureText` would, so component tests are deterministic about *that* the box
    follows the text and leave the exact numbers to the layout's unit tests.

14. **`transactionOrigin(...)` is variadic.** Observers get `(event, transaction)`, the `Doc`'s
    `update` event gets the origin directly, and a transaction is sometimes handed over alone; the
    function scans its arguments for the first one that carries an origin and returns `undefined`
    when none does.

15. **`setCamera` in the e2e helpers now waits for the drawing, not just the state.**
    Camera updates are coalesced into a frame, so `getCamera()` can already report the new camera
    while the screen still shows the old one. Story 2's far-travel test (TC-27) read the grid right
    after a `setCamera` and failed only in a busy parallel run. It now also waits for the viewport's
    `data-camera-x/y/zoom`, which is what the drawing was made from.

16. **Concurrent typing is asserted by character counts, not by string equality** (as in story 3's
    TC-23): two people typing `AAAA` and `BBBB` into one text must end with at least four of each in
    both documents, and both documents must hold the same string. The interleaving is the CRDT's
    business.

17. **Firefox and WebKit still cannot launch on this machine** (missing system libraries), so
    tasks.md's "TC-26 in firefox and webkit too" was not run here; every other e2e case ran on
    Chromium (67 tests, and the suite twice in a row green). The playwright config skips the two
    projects with a warning rather than failing, so the cross-browser wrapping check happens on a
    host that has the browsers.

# Story 10 Implementation Notes

Shapes with labels, and arrows that stay attached to them. What the design asked for, what was
built, and the places where the built thing is deliberately different.

## Deviations from design.md

1. **`ShapeObject` and `ConnectorObject` receive the object as `note`.**
   The design's file table gives them `shape: ShapeSnap` and `connector: ConnectorSnap`. The registry
   renders every object through one component signature (`ObjectProps`), whose object prop is called
   `note` - the name sticky notes gave it in story 2 - and `Board.tsx` passes `note` to everything.
   A second naming would have meant either a special case in the render loop or a rename through
   four stories of tests, so the two new components read `note` and narrow it themselves
   (`isShapeSnapshot` / `isConnectorSnapshot` are already there for exactly this).

2. **An arrow stores its ends as plain objects, not as nested `Y.Map`s.**
   `{ kind: 'attached', objectId, fallback: {x, y} }` and `{ kind: 'free', x, y }`, written with one
   `map.set('from', ...)` per end. An end is only ever replaced whole - never edited in place - so
   the sharing a nested `Y.Map` would buy is never used, and the reads stay one `map.get`.

3. **`detachConnectorsTo` runs before the objects are deleted, in the same transaction.**
   An end that is being set free is set free *at the side of the shape it was on*, which needs that
   shape's rectangle. Story 7's `deleteObjects` therefore asks the connector module first and removes
   the objects second, inside one `doc.transact`: one update on the wire, and no state in which an
   arrow has been left with nothing to measure against.

4. **`moveObjects` and `resizeObjects` skip arrows.**
   An arrow's `x`, `y`, `width`, `height` are a bounding box derived from its ends, so writing a
   position to it would be writing nonsense that the next snapshot throws away. Selecting an arrow
   and dragging it therefore moves nothing - which is what the picture shows, since the line stays
   where its two shapes are.

5. **`ConnectorSnapshot` carries its resolved `ends`.**
   `resolveEndpoints` needs every shape's rectangle, and the renderer would otherwise have to be
   handed a map of them. Snapshot time is where the map already is, so the snapshot carries
   `{ from: Point, to: Point }` and `ConnectorObject` draws what it is told. The cost is one more
   derived field; the gain is that the picture cannot disagree with the document about which side an
   arrow left from, because there is only one place that decides.

6. **Each end is aimed at the *centre* of the object at the other end, not at that end's anchor.**
   The anchor of one end depends on the side the other end faces, and the side the other end faces
   depends back; a pair that depends on itself has no answer. Centres break the circle and pick the
   same side for every shape but the degenerate.

7. **The Shape tool creates at the point the pointer went down, and hands the pointer back to Select
   after both a drag and a click.**
   `tasks.md`'s "click makes a default-sized shape centred on the click point" and `design.md`'s
   state diagram (`Sizing --> [*] : pointerup create and switch to Select`) agree that one gesture is
   one shape: the tool is not a stamp that stays down. The click case takes the `rect: null` path, so
   `createShape` decides the default size, and the point it centres on is `p0` - where the pointer
   went down - because that is the point the person was aiming at, and a shape that appeared half a
   default size away from the cursor would look like a bug.

8. **The keyboard belongs to `useActiveTool`, and `S` means "the kind I drew last".**
   V/T/S/L and Escape live with the tool hook rather than `useBoardKeys`; the overlap on V, T and
   Escape is idempotent (both set the same tool), and it keeps the story's three new shortcuts and
   their `canEdit` guard in one file. Pressing `S` resolves through `shapeToolId(lastShapeKind)`, so
   somebody drawing diamonds does not find themselves drawing rectangles every time they reach for
   the keyboard.

9. **`.board-toolbar` is above the tool surface; the surface is above the board.**
   The shape and connector tools cover the whole viewport with a capture surface (z-index 15), which
   would otherwise swallow the click on the Select button that is the only way out of the tool
   besides Escape. The toolbar is 30, so arming a tool never locks the toolbar away.

10. **An arrow only answers on the line.**
    The wrapper div is `pointer-events: none`, an invisible `line` under the visible one is
    `pointer-events: stroke` and `strokeWidth = (CONNECTOR_HIT_TOLERANCE_PX * 2) / zoom`, and the
    wrapper's own handler measures the same distance (`hitConnector`) before it stops propagation.
    The bounding box of a diagonal arrow is mostly empty board, and a click in that emptiness has to
    reach the board. Both measures are the same function, so what a person can hit and what the code
    thinks they hit are one rule.

11. **`hitConnector` is exported from `connector-geometry.ts`, and the registry's `hitTest` calls it
    at zoom 1.**
    One rule, two callers. `ConnectorObject` measures a click with the live zoom, which is the zoom
    the click was made at; the registry entry that `tasks.md` asks for has no camera to ask, so it
    answers for the board at 1:1. Nothing in the board calls the registry's `hitTest` today -
    selection and the marquee work from bounding boxes, and `ConnectorObject` refuses the empty
    corner of an arrow's box itself - so the entry is the interface's honest version of the rule
    rather than the one a pointer meets; the unit test for it covers the corner case that makes the
    difference visible.

12. **The label's toolbar counter-scales with `--shape-inverse-zoom`.**
    Set by `ShapeObject` from the live zoom, read by the stylesheet's
    `transform: scale(var(--shape-inverse-zoom, 1))`, the same mechanism the note's colour bar and a
    text's size picker use. A toolbar that grew with the board would be a wall of swatches at 400%.

13. **New test hooks: `createShapeAt` and `createConnectorBetween`.**
    Story 9 left `createTextAt` and nothing else; a shape or an arrow test that had to build its
    board by pointing at pixels would spend the whole test on setup. Both hooks call the real model
    (`createShape`, `getShapeLabel().insert`, `createConnector`) in the page, so a fixture board is
    still a board the model made, and the pointer is left for the gestures a test is actually about.
    The label goes in through `insert`, which is what typing into the editor would have done.

## Facts about shapes, geometry and CSS that shaped the tests

14. **`nearestSide` is a cone test, not a distance test.**
    `|dy| * width <= |dx| * height` decides horizontal over vertical without dividing, and reduces to
    the familiar 45 degrees for a square. A "nearest edge by distance" rule would put the end of a
    wide, flat diamond on its top corner for a target almost level with it, which reads as the arrow
    changing its mind.

15. **An end whose object is gone is drawn at its own `fallback`.**
    That is the whole of the delete-race promise, and it is why `createConnector` keeps the caller's
    fallback for an object that is not on the board instead of refusing: an arrow that arrives at a
    shape somebody else is deleting is created, and drawn where the pointer let go. TC-27 asserts the
    position and *reports* which of the two interleavings happened - free end at the release point, or
    attached to the id that is gone - because the room decides, and both are correct.

16. **The connector's SVG is drawn in world units.**
    `viewBox="${left} ${top} ${width} ${height}"` with `x1`/`y1` straight from the ends, so an e2e
    test can read `x2` off the DOM and compare it with what the document says without knowing the
    camera at all. That is what makes "both screens show the same arrow" an assertion instead of a
    screenshot.

17. **A shape's label is centred by CSS, and measured in world units.**
    `.shape-object__label` is `position: absolute; inset: 8px` with flex centring and
    `pointer-events: none`; the font is `SHAPE_LABEL_FONT_SIZE_WORLD` (16) and the stylesheet's
    `line-height: 1.25`. The e2e centring check compares `offsetLeft/offsetWidth` against the shape's
    own box - offsets inside the shape, so they are world units and hold at any zoom - and the wrap
    check asks for more than 1.5 times one line's height, which is the point where "it wrapped" stops
    being a guess.

18. **`SHAPE_DEFAULT_SIZE_WORLD` is a world size, so 200% zoom does not make a bigger shape.**
    TC-24 clicks at 200% and expects the same 160x160 as at 100%, and gets it: the tool converts the
    screen point to world before asking for the shape. What doubles is the picture of it.

19. **`data-selected`, `data-shape-id`, `data-connector-id`, `data-handle`: the e2e suite reads the
    board through attributes, not through pixels.**
    Already the convention for notes; the two new object types carry the same, and the selection
    overlay's handles have carried `data-handle` since story 7.

## E2E, and this machine

20. **Playwright cannot delay the frames of a WebSocket that is already open**, so `tasks.md`'s
    "(Playwright route delay on Sam's WebSocket traffic to force overlap)" is not available:
    `page.route` does not intercept WebSocket messages, only the upgrade request. TC-27 therefore
    arranges the overlap instead of timing it - Dana's pointer is down over B, Sam deletes B, the test
    waits until *Dana's document* says B is gone, and only then lets the pointer up. That is a harder
    guarantee than a delay: the delete provably landed in the middle of the gesture.

21. **TC-23 runs in every engine; TC-24 to TC-27 are skipped outside chromium, which is what the
    story's "Done when" asks for** ("All functional assertions pass in chromium; TC-23 also in
    firefox and webkit"). The multi-context cases are the expensive ones, and three engines' opinions
    of the same pointer sequence is the part of the suite's wall clock this story can give back.
    As in stories 8 and 9, Firefox and WebKit cannot launch on this machine (missing system
    libraries), so the playwright config skipped those two projects here with its usual warning and
    TC-23's cross-browser claim is one this host cannot make.

22. **The design's people are called Dana and Sam; `PARTICIPANT_NAMES` does not have a Dana.**
    Rather than renumber every other story's participants, the connector spec sets `.name` on the two
    contexts it opened, so a failure says "Dana" where the design says Dana.

23. **The checkout-flow fixture describes a board; the board is built by the model.**
    `tests/fixtures/checkout-flow.ts` is data - four labelled shapes and four arrows - plus the
    mapping from a fixture end to an `Endpoint`. `applyCheckoutFlow` in the e2e helpers walks that
    data through `createShapeAt` / `createConnectorBetween`. Nothing serialises a board to be pasted
    in, which is how the other fixtures work and the reason a fixture board cannot encode a state the
    model would have refused. It also has one arrow whose head is free on purpose: a fixture with
    only attached arrows never shows what an arrow does when the thing at its end is gone.

# Story 11 Implementation Notes

Freehand ink: a Pen tool that draws a smooth line under the pointer and leaves an ordinary board
object behind when the pointer comes up. What was built, and the places where it differs from the
design's sketches.

## Deviations from design.md

1. **`StrokeObject` receives the object as `note`.**
   Story 10's reason, unchanged: one component signature (`ObjectProps`) for every object type, and
   the prop the registry passes has been called `note` since sticky notes. The component narrows it
   with `isStrokeSnapshot`.

2. **The registry's `hitTest` takes an optional third argument: `zoom`.**
   `design.md` gives `hitTest(obj, worldPoint): boolean`. A stroke's hit rule is written in *screen*
   pixels (`STROKE_HIT_TOLERANCE_PX`), so a two-argument `hitTest` can only answer honestly for a
   board at 1:1. The parameter is optional and defaults to 1, so the existing entries and every
   existing caller are untouched, and the stroke entry answers for the zoom the pointer is actually
   at - which is what TC-15's 50% and 200% rows ask for.

3. **`PenTool` takes an `undo` prop and calls `undo.boundary()` after every commit.**
   Not in the design's props table. Without it, a gesture that commits several strokes (the
   5,000-point split) or two quick strokes would land in one undo group; with it, one committed
   stroke is one step back, which is what a person reaching for Ctrl+Z expects.

4. **The Pen commits its own strokes instead of calling `toolCreated`.**
   `toolCreated` is the Shape tool's "hand the pointer back to Select" signal, and the Pen must stay
   armed after every line (TC-09). It therefore writes through `createStroke` directly and leaves the
   tool alone; `Board.tsx` still owns the camera, the doc and the identity it hands down.

5. **The stroke's points are recorded in world units, and the preview converts them to screen pixels
   each frame.**
   The other way round - storing screen pixels - tears the line the moment the board moves under it,
   and a two-finger scroll in the middle of a long stroke is not rare. `paint()` maps every stored
   point through the live camera before writing `d`, so a mid-stroke pan or zoom moves the ink with
   the board it belongs to.

6. **A drag past `STROKE_MAX_POINTS` commits as it goes.**
   `splitPoints` returns consecutive parts that share their join point; the PenTool commits every part
   but the last and keeps drawing the last one, so the second stroke starts exactly where the first
   stopped (TC-12) and the person never loses a line to a limit they cannot see.

7. **A press that never moves commits a single point.**
   One point is `M x y L x y`, which a round line cap draws as a dot of the pen's thickness. That is
   the tap-makes-a-dot requirement, and it is why `createStroke` accepts a one-point array: refusing
   it would throw away the shortest thing a pen can make.

8. **`onLostPointerCapture` ends the gesture rather than dropping it.**
   A pointer that leaves the window has already drawn a line; committing what was drawn is the same
   rule as `pointercancel` (TC-11), and the only way to abandon a stroke in the air is Escape or
   another tool (TC-13).

9. **The preview is one `<path>` updated imperatively, not React state.**
   A 5,000-sample drag would re-render the app once per sample. `PenTool` keeps a ref to the path
   element and writes `d` inside a `requestAnimationFrame` coalescer; React renders the element once
   when the gesture starts and removes it when it ends. The `d` it writes comes from `smoothPath`,
   the same function the committed object renders, so the line does not change shape when it lands.

10. **`PenToolbar` sits at `left: 70px`, vertically centred.**
    `ux.md` asks for the pen's bar beside the tool toolbar rather than under the object like the shape
    label's; `.board-toolbar` keeps z-index 30 so the bar stays clickable above the pen's own capture
    surface, which is z-index 15.

## Facts about ink, geometry and jsdom that shaped the tests

11. **Ramer-Douglas-Peucker with a tolerance in screen pixels converted to world units.**
    `simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom)`: one pixel of slop at the zoom the stroke
    was drawn at, whatever the board's scale. The loop is iterative because a 5,000-sample drag
    recurses two thousand frames deep otherwise. First and last points are always kept, so a stroke
    never shrinks at its ends, and TC-01's collinear middle point is removed exactly.

12. **`smoothPath` emits `M`, then one `Q` per interior point, then `L`.**
    Control point = the sample, end point = the midpoint of the sample and the next one, which makes
    the curve pass through the middle of every segment and get pulled towards the samples without
    reaching them. TC-04 pins the shape with a regex rather than an exact string, because the numbers
    are floats and nobody should have to re-derive them to fix the test.

13. **`scaledPoints` is a pure function, which is the whole of "resized proportionally".**
    The resize gesture writes only `x`, `y`, `width`, `height`; the points are re-derived at render
    time from the box they were made in, so a stroke can be resized, moved and undone without its
    geometry ever being written twice or drifting out of step with its box. `aspectLocked: true` in the
    registry keeps the aspect ratio; `minSize` is `STROKE_MIN_SIZE_WORLD` (4) so a flat line still has
    a handle to grab.

14. **The hit path is invisible and as wide as the rule, in screen pixels.**
    `strokeWidth = 2 * max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom)` with `vector-effect:
    non-scaling-stroke`, over a wrapper that is `pointer-events: none`. Both the DOM and `hitStroke`
    read the same rule, so what a person can click and what the code says they clicked cannot disagree
    - the same argument story 10 made for arrows, one curve at a time.

15. **jsdom does not honour CSS `pointer-events`, so TC-16 is asserted as geometry.**
    The component test checks the rule (`hitStroke` misses 40 units above the line while the sticky
    under it is hit) and the width the browser will be given, rather than clicking a DOM node that
    jsdom would happily hit-test through the wrapper. The pixel claim - a click in the middle of a
    stroke's box selects the note underneath - is e2e's, in TC-20, where the hit test is real.

16. **`createStroke` refuses and returns `''`.**
    Empty points, a non-finite coordinate, an unknown colour or thickness: no object, no exception,
    like `createSticky`. A drag that produced nothing after simplification is therefore not a failure
    path, and the test-mode hook's return value tells a test which one it got.

## E2E, and this machine

17. **"Nobody sees a half-finished line" is a real assertion here, and the timing half is a
    measurement.**
    Story 10 established that Playwright cannot delay frames of an open WebSocket (`page.route` does
    not intercept messages), so TC-18 does the harder version: Priya drags while Sam polls, and zero
    strokes must be visible to Sam for the whole drag; the release's single update is then timed with
    `LatencyLog` against the story's 1,000 ms budget - 4 ms to 31 ms on this machine - and Sam's board
    is required to agree with hers on the object, and to still have it after a reload.

18. **"Repainted every frame" is sampled inside the page.**
    A Playwright-side poll can be satisfied by one snapshot, which is exactly the bug the requirement
    is about. `previewPathAcrossFrames` runs an rAF sampler in the page while the test moves the
    mouse, and requires several distinct `d` strings with more quadratic segments in the later ones.

19. **Every screen coordinate aimed after a pan or zoom is read from the live camera, and checked to
    be on screen.**
    The first version of TC-19 aimed the drag with `toScreen(world, zoom)` built from the camera the
    test *started* with. After a pan and a zoom that point was at a negative y, Chromium dropped the
    `mouse.move` without a word, and the test waited fifteen seconds for a stroke that was never going
    to happen. It now uses `screenOf` (which asks the running app) and asserts both ends of the drag
    are inside the viewport, so a bad aim fails with a number instead of a timeout.

20. **Small wheel deltas, on purpose.**
    `zoom factor = exp(-deltaY * 0.01)`, so a 240-unit notch is 11x and hits the 4x ceiling - which
    moves the whole board off screen and silently breaks every later gesture in the test. TC-19 pans
    with 60 and zooms with 40, and asserts the zoom landed strictly between 1 and the maximum.

21. **`createSticky` centres the note on the point it is given.**
    A test that assumes it places the top-left aims at the corner of the note it is trying to draw
    over. TC-19 reads the box back from the document and drags from its middle.

22. **After `page.reload()`, `waitForBoard` before touching `window.__vidi6`.**
    The hook is not there until the app has booted again; polling the document without that wait fails
    with "window.__vidi6 is missing" instead of the assertion anyone wanted.

23. **TC-17 runs in every engine; TC-18 to TC-20 are chromium-only, which is what "Done when" asks
    for.** As in stories 8 to 10, Firefox and WebKit cannot launch on this host (missing system
    libraries), so the playwright config skips those two projects here with its usual warning. TC-17 is
    written without a single engine's quirks - plain pointer, plain rAF - so it will run where they can.

---

# Story 12 Implementation Notes

Decisions and deviations from the spec/design that future readers should know:

## Shared model

1. **`placementSize` returns `null` for a size that is not finite or not positive.**
   The design's signature has it answering `Size`. A zero-byte or absurdly scaled file is exactly the
   thing that reaches this function from outside, and `null` means the caller refuses the file instead
   of writing a box with no area that every later geometry has to argue with.

2. **An unrecognised `status` in stored data reads as `failed`.**
   `statusOf` coerces anything it does not know. A placeholder that cannot be understood is not
   "uploading" (nobody is sending anything) and certainly not "ready" (there is no picture to show);
   `failed` is the state that offers the person the two things they can actually do.

3. **`displayStatus` normalises unknown values to `failed` for the same reason.** The placeholder's
   wording is a decision, and the safest decision is the honest one.

## Asset API

4. **A corrupt PNG is *accepted* by the server.**
   Sniffing twelve bytes says "this is a PNG"; it cannot say the IDAT stream is broken. The design
   covers this case elsewhere: the browser is the one that discovers the picture will not load, and the
   placeholder becomes an "Image unavailable" box. Integration tests document it rather than assert a
   415 that would be a lie about what a magic-number check can know.

5. **The integration tests' recording bucket is a Proxy over the real local R2 bucket.**
   The point is to observe which keys were written and read while the real storage still answers, so
   nothing about the serving path is faked.

6. **Fixtures larger than 10 MB are not committed.** `scripts/generate-image-fixtures.mjs` writes them;
   tests that need an oversized file build one in memory (a real JPEG header plus padding), because the
   size limit is a decision about bytes made before anything is decoded.

## Client

7. **Drop and paste listeners live on `window`, not on the viewport.**
   The viewport is `position: fixed; inset: 0`, so the two are equivalent for hit purposes, and a file
   dragged over the toolbar or the share panel is still a file dragged over the board. The handlers
   refuse to act while a text field has the focus (`isTextEntry`), which is what keeps a paste into a
   note being edited a paste into that note.

8. **The Image tool is an action, not a mode.** `TOOL_KEYS` has `i`, `useActiveTool` intercepts it
   before the built-tool check and opens the picker; the board stays on Select. A person who presses `I`
   twice expects two picker dialogs, not a tool they have to leave.

9. **`ImageInsertController` does not extend `ImageInsertActions`; `Board` composes the context.**
   The hook owns the bytes and their progress; deleting an object needs the history boundary and
   `deleteObjects`, which are the board's. So the hook's own removal is called `forget` - it stops
   tracking a file - and the context's `remove` is the board's, which does both.

10. **Per-mount random identity (`newBoardId()`), because story 6 is not in this build.** Two tabs of
    one board are two identities, so a Retry is only possible on the screen that still holds the file -
    which is the behaviour the PRD wants after a reload, arrived at for the honest reason.

11. **The stale-upload clock is one shared `setInterval` that exists only while somebody is waiting.**
    `useImageClock` subscribes when an image has `status === 'uploading'`; the tick is
    `IMAGE_CLOCK_TICK_MS` (30s), which is finer than the 5-minute stale line, so the box changes from
    "Uploading…" to "Image upload didn't finish" without anybody having to interact.

12. **`ImageObject` owns its own `broken` flag**, reset when `assetKey` changes. Whether a given
    address loads is a fact about this screen's afternoon, not about the image, so it is not written to
    the document; when `status === 'ready'` and the picture errored, the same box is drawn at the same
    size with "Image unavailable".

## Tests

13. **`clampScale`'s aspect-locked branch is fixed for shrinking** (`src/shared/geometry.ts`).
    It took `Math.min` of the two clamped scales in both directions, which for a *shrinking* drag is
    the *less* restrictive answer: a 400x300 image dragged inward ended at 16x12, under
    `IMAGE_MIN_SIZE_WORLD` on its short axis. The branch's own comment said "use the more restrictive",
    so this is a bug fix rather than a change of behaviour: growing still stops at whichever axis would
    overflow first, shrinking now stops at whichever would fall under its minimum first. Story 12's
    TC-29 is what caught it; every existing geometry test (all square rects) passes unchanged.

14. **Component tests stub `createImageBitmap` and `uploadImage`, and nothing else.**
    A jsdom board can neither decode a picture nor transfer bytes; the percentage, the retry and the
    refusal wording are all asserted through those two seams, against the real document and the real
    provider over the scripted socket.

15. **E2E drops are built as a real `DataTransfer` in the page** (`tests/e2e/helpers/images.ts`), and
    those two tests are Chromium-only, which is what the design fixes. The picker path - Playwright's
    own file-chooser interception - runs in every engine.

16. **One E2E latency sample is over budget by design.** TC-25 stalls uploads for 1.2s so that
    "Uploading…" is a state a colleague can be shown rather than a flicker; that leg's label says so,
    and the budget is reported, never asserted.

## This machine

17. **Firefox and WebKit cannot launch here** (missing system libraries; an unprivileged user cannot
    install them). `playwright.config.ts` detects it and skips those two projects with its standing
    warning, so `npm run test:e2e` runs Chromium only on this host. TC-26 is written without any
    engine-specific API - `setInputFiles` with in-memory files, plain DOM reads - so it will run in all
    three where they can start. Nothing in story 12 is blocked for any other reason.
