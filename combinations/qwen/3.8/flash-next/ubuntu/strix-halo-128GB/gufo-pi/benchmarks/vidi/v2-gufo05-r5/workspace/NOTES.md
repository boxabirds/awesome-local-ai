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
