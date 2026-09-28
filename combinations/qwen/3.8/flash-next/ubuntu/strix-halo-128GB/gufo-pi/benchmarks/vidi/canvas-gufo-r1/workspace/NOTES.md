# Implementation Notes

## Story 5: Share a board with others using a link

### Key Decisions

1. **Board creation is server-side**: `POST /api/boards` → rate-limited → `createWithRetries(newBoardId, stub.initialize())`. The rate limiter is configured in `wrangler.jsonc` as a native Cloudflare Workers `ratelimits` binding (10 per 60 seconds, keyed by `CF-Connecting-IP`).

2. **`BoardRoom.initialize()` RPC**: Creates SQLite tables via `store.migrate()`, then checks/inserts `created_at` in `storage_meta`. Returns `'created'` on first call, `'exists'` on subsequent calls. This is idempotent.

3. **`BoardRoom.exists()` RPC**: Calls `store.existsReadOnly()` which is a pure read — no writes. Checks: tables exist → `created_at` row → legacy rows in `updates`/`snapshot_chunks`.

4. **Lazy loading**: `BoardRoom` no longer auto-loads in `constructor()`. Instead, `loaded` flag gates lazy `loadFromStorage()` in `fetch()`. This avoids creating tables for boards that are never initialized.

5. **`fetch()` checks existence**: Before accepting WebSocket upgrade, `BoardRoom.fetch()` calls `existsReadOnly()`. Returns 404 for boards that don't exist. This prevents WebSocket connections to non-existent boards.

6. **`BoardStore.load()` handles missing tables**: If `storage_meta` table doesn't exist in `sqlite_master`, returns `{ok: true, quarantined: 0}` without creating anything. This supports the lazy-load pattern.

7. **`BoardStore.append()` does lazy migrate**: If not yet migrated in this session, calls `migrate()` before inserting. This supports boards that receive updates before `initialize()`.

8. **Malformed board IDs → 404** (was 400 in story 3): Both `/api/boards/:id` and `/api/rooms/:id` return 404 for invalid IDs.

9. **Client router**: History API-based, no library. Routes: `/` → Home, `/b/:id` → Board, anything else → NotFound. `useRoute()` hook listens to `popstate`.

10. **Board page existence check**: `GET /api/boards/:id` on mount. States: `checking` (shows "Opening board…"), `not_found` (renders NotFoundPage), `unreachable` (shows "Couldn't reach vidi6. Retrying…" with exponential backoff capped at `RECONNECT_MAX_BACKOFF_MS`).

11. **Share panel**: Opens on "Share" button click. Shows link input (read-only), "Copy link" button, note text. Clipboard API with fallback to manual copy (`select()` + "Press Ctrl+C" message). "✓ Link copied" shown for `LINK_COPIED_MS` (2000ms). Closes on Escape key or outside pointerdown.

12. **`<meta name="referrer" content="no-referrer">`**: Added to `index.html` to prevent board IDs leaking via referrer headers.

13. **`BoardApp` extracted from `App`**: The board UI (canvas, toolbars, notes) was extracted into `BoardApp.tsx` so `App.tsx` can be a thin router wrapper. Component tests (Toolbars) use `BoardApp` directly.

### Gaps in Prior Stories

- **Story 3 (real-time collaboration)**: Previously used `newBoardId()` on the client side to create rooms implicitly via WebSocket connection. Story 5 requires boards to be explicitly created first. Integration tests were updated to use `runInDurableObject` + `initialize()` instead of relying on implicit board creation through WebSocket.
- **E2E tests**: Updated `gotoBoard()` and `makeBoardId()` helpers to create boards via `POST /api/boards` API before navigating.
- **Test hooks**: Added `POST /__test/boards/:id/seed-legacy` hook to seed a legacy board (tables + update rows, no `created_at`) for testing story 5's existence check against pre-story-5 boards.

### Rate Limiter in Tests

- Integration tests use unique `CF-Connecting-IP` headers per test to avoid mutual rate-limit interference.
- TC-13 specifically tests the limit boundary (10 from same IP → 201, 11th → 429).

## Story 7: Select, move, resize and delete several objects at once

### Key Decisions

1. **Selection is a reducer**: `useSelection` uses `useReducer` with `SelectionState = { ids: ReadonlySet<string>, editingId: string|null }` and actions: `click`, `toggle`, `setMany`, `clear`, `prune`, `edit`. The reducer is exported for unit testing.

2. **Group model functions**: `moveObjects`, `resizeObjects`, `bringObjectsToFront`, `deleteObjects` operate on arrays of ids. Existing single-object functions (`moveObject`, `bringToFront`, `deleteObject`) are thin wrappers.

3. **Geometry helpers**: `src/shared/geometry.ts` provides `Rect`, `Point`, `Handle` types and pure functions (`rectContains`, `unionRects`, `normalizeRect`, `resizeRect`, `clampScale`, `scaleWithin`).

4. **Object type registry**: `src/client/objects/registry.tsx` defines `ObjectTypeSpec` with `resizable`, `aspectLocked`, `minSize`, `editableText`, `hitTest`. Only `sticky` is registered so far.

5. **Transform gesture**: `useTransformGesture` handles group move (drag any selected object → all move) and handle resize (bounding-box proportional scaling with `scaleWithin`). RAF-coalesced writes. `onGestureStart`/`onGestureEnd` hooks for suppressing edit UI.

6. **Marquee selection**: Shift+pointerdown on empty board starts marquee. Only fully-contained objects are added to the selection. Plain drag (no Shift) pans camera. `useMarquee` hook + `MarqueeRect` component.

7. **Keyboard commands**: `useBoardKeys` handles Ctrl/Cmd+A (select all), Escape (clear), arrows (nudge 1/10 world units), Delete/Backspace (delete selection). Guards on `editingId` and input focus.

8. **Resize is aspect-locked for stickies**: `scaleWithin` maps child rects proportionally from source bbox to target bbox. `clampScale` prevents below `STICKY_MIN_SIZE_WORLD` or above `MAX_OBJECT_SIZE_WORLD`.

9. **Selection auto-prunes**: When the snapshot changes, remote-deleted ids are automatically removed from the selection set (prune action in reducer).

10. **`useBoardDoc` uses `useState` instead of `useSyncExternalStore`**: `useSyncExternalStore` with React 19 had an issue where text-only Y.Doc updates fired `observeDeep` but did not trigger re-renders. Switched to `useState` + `useEffect` observer pattern.

### Gaps in Prior Stories

- **Story 3/5 (e2e tests)**: Wrangler v3 doesn't support `ratelimits` binding locally. Added an in-memory `MemoryLimiter` fallback in `src/worker/index.ts` and a `POST /api/test/reset-rate-limit` endpoint for tests.
- **Story 5 (`.dev.vars`)**: Created `.dev.vars` file with `TEST_HOOKS=1` since wrangler doesn't pass shell env vars to worker code.
- **Story 5 (`run_worker_first`)**: Added `run_worker_first: true` to `wrangler.jsonc` assets config so the worker handles `/api/*` and `/__test/*` paths before the static asset middleware (which returns 405 for POST to non-existent paths).
- **Story 5 (`testHooks.ts`)**: Fixed `installDocHooks` to create `window.__vidi6` if it doesn't exist (was previously silently failing when `installDocHooks` ran before `installTestHooks`).
- **Story 2 (`StickyNote`)**: Sticky note pointer events now delegate to `onObjectPointerDown` prop for the transform gesture, instead of internal drag logic.
- **Share-board TC-26**: Updated test to use `create-sticky-btn` (was `add-sticky-btn`) and `toPass()` retry block to handle textarea value vs textContent for edit-mode sync.
