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
