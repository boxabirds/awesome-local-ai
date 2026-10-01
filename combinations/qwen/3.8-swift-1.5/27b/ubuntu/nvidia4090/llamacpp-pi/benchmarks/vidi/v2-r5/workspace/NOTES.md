# Story 5: Share a board with others using a link

## Decisions

### Board existence model
- A board **exists** iff its Durable Object's storage contains the `updates` table (checked via `sqlite_master`).
- `created_at` in `storage_meta` is a convenience timestamp set at creation time but is **not** the existence criterion.
- Legacy boards (created before this story) that have `updates` rows but no `created_at` are treated as existing.
- This means: opening a link to a board that was created but never written to will show "Board not found" (no table = no existence). This is acceptable per the design doc because a board with zero content is indistinguishable from a non-existent board.

### `existsReadOnly()` implementation
- Uses `SELECT name FROM sqlite_master WHERE type='table' AND name='updates'` — a read-only query that never creates tables.
- The `BoardStore` constructor no longer calls `migrate()`. Migration is lazy: `ensureMigrated()` is called before the first `append()`.
- This ensures that a `GET /api/boards/:id` or WebSocket connection to an unknown board does not write to storage.

### Lazy migration
- `BoardStore.migrate()` is now idempotent and called via `ensureMigrated()` before the first write.
- `initialize()` RPC calls `migrate()` explicitly (since it's the creation path).
- `load()` handles the case where tables don't exist yet (returns empty log).

### Worker route changes
- `POST /api/boards` → 201 with `{ id }` or 500 with `{ error: 'create_failed' }`
- `GET /api/boards/:id` → 200 with `{ id }` or 404 with `{ error: 'not_found' }`
- `GET /api/rooms/:id` (non-WebSocket) → 404 for unknown boards (was 400 for malformed, now 404 for both malformed and unknown)
- WebSocket upgrade to unknown board → 404 (the `BoardRoom.fetch` checks `existsReadOnly()` before accepting)

### Client router
- Minimal History API router with three routes: `/` (home), `/b/:id` (board), not_found
- No external router dependency
- `navigate()` helper pushes to history and dispatches `popstate` for reactivity

### BoardPage existence check
- On mount, `BoardPage` calls `GET /api/boards/:id`
- Shows "Opening board…" while checking
- On `not_found` → renders NotFoundPage
- On network failure → exponential backoff retry (1s, 2s, 4s, … max 10s) with "Couldn't reach vidi6. Retrying…"
- On success → renders BoardContent

### Share panel
- Toggle panel (not a modal) with the share link
- `navigator.clipboard.writeText` with graceful fallback
- On clipboard failure: selects the input text and shows "Press Ctrl+C (Cmd+C on Mac) to copy"
- "✓ Link copied" confirmation for exactly `LINK_COPIED_MS` (2000ms)
- Closes on Escape or outside click; focus returns to the Share button

### Pre-existing component test updates
- Added `vi.mock('../../src/client/api')` to StickyNote, StickyTextEditor, and Toolbars tests
- Added `window.history.pushState` to set a valid board URL
- Made test callbacks async to await the BoardPage's existence check resolution
- Used a valid 22-character board ID (`testboardid1234567890a`)

### Mock storage updates
- `MockDurableObjectStorage` now tracks created tables in a `createdTables` set
- Supports `sqlite_master` queries for `existsReadOnly()`
- Supports `INSERT OR REPLACE` syntax (used by `setCreatedAt`)

## Test coverage

| TC ID | Type | Description |
|-------|------|-------------|
| TC-04 | unit | Board ID format (pre-existing) |
| TC-05 | integration | POST creates, GET confirms |
| TC-06 | integration | GET fresh → 404, no tables |
| TC-07 | integration | Malformed IDs → 404, no RPC |
| TC-08 | integration | Legacy board → exists |
| TC-09 | integration | WebSocket unknown → 404 |
| TC-10 | integration | WebSocket known → accepted |
| TC-12 | integration | RPC failure → 500 |
| TC-14 | integration | PUT → 405 |
| TC-15 | integration | initialize idempotent |
| TC-16 | component | Home: create + navigate |
| TC-17 | component | Home: failure message |
| TC-19 | component | Board: malformed → not found |
| TC-20 | component | Board: unknown → not found |
| TC-21 | component | Board: retry then success |
| TC-22 | component | Share: copy + timing |
| TC-23 | component | Share: clipboard reject |
| TC-24 | component | Share: no clipboard API |
| TC-25 | component | Share: Escape/outside/focus |
| TC-26 | e2e | Create, share, join |
| TC-27 | e2e | Bad link recovery |
| TC-28 | e2e | Flaky service retry |
| TC-29 | e2e | Clipboard blocked |
| TC-31 | e2e | Pre-existing board |
| TC-32 | integration | no-referrer meta tag |
