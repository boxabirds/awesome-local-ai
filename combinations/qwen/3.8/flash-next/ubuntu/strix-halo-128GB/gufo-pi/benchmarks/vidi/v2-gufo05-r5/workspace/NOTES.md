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
