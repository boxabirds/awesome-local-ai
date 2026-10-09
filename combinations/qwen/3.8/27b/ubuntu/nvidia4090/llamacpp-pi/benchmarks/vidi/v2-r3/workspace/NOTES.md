# NOTES — Stories 4–5 (and the story 1–3 gap fill)

## 1. The repository was empty: stories 1 and 2 had to be gap-filled

No code from story 1 (board skeleton + pan/zoom) or story 2 (sticky notes) was
ever committed, but story 3 ("see other people's edits appear live") is
meaningless without a board to edit. Rather than stub, mock, or fake the
underlying product, I implemented the story 1 and story 2 product surface to the
extent story 3 depends on it, matching the story 1/2 design files (named
settings, exported interfaces, exact UI text and `aria-label`s). This is a
**gap fill**, not new scope for story 3.

What was built so live collaboration has something to collaborate on:

- **Story 1 (canvas):** `src/client/canvas/*` (camera model, pan by drag,
  wheel/button zoom with `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP_FACTOR`/
  `WHEEL_ZOOM_SENSITIVITY`, world-space dot grid at `GRID_SPACING_WORLD`),
  `src/client/board/Toolbar.tsx`, `src/client/App.tsx`, `src/client/main.tsx`,
  `src/client/styles.css`, `index.html`.
- **Story 2 (sticky notes):** `src/client/objects/*` (note creation by
  double-click or toolbar, drag to move with `DRAG_THRESHOLD_PX`, inline text
  editor with `STICKY_TEXT_MAX_CHARS` and the character counter, 6-colour
  palette `STICKY_COLORS`, delete, selection model), and the shared CRDT
  board model `src/shared/board-model.ts` (`initDoc`, `createSticky`,
  `moveObject`, `setStickyColor`, `deleteObject`, `bringToFront`, `snapshot`,
  `getStickyText`).
- **Shared:** `src/shared/config.ts` (all named settings for stories 1–3),
  `src/shared/board-id.ts`, `src/shared/protocol.ts`.

These are real, working product features — the e2e suite drives them through
the real UI (double-click to create, drag to move, type text, recolour,
delete), not through test hooks. The `window.__vidi6` test hooks (test builds
only) expose just `setCamera` and `connectionState`, as the story 3 design
specifies.

## 2. Wire-format fix: sync frames are raw, not length-wrapped (the real bug)

The single most important correctness fix. y-websocket's on-the-wire framing is
**type-specific**:

- `MESSAGE_SYNC` (0): `varUint(0)` followed by one or more **raw** y-protocols
  sync messages (no length prefix).
- `MESSAGE_AWARENESS` (1): `varUint(1)` + a `varUint8Array`-wrapped payload.
- `MESSAGE_QUERY_AWARENESS` (3): `varUint(3)`, no payload.

`src/shared/protocol.ts` originally wrapped *every* payload in a
`varUint8Array`, so the room mis-parsed a real `WebsocketProvider`'s first
frame (the on-open step1) as an empty sync payload and closed the socket with
`1003 unsupported data`. The browser client then reconnected in a loop and the
badge never left "Connecting…". Because the integration test client
(`tests/integration/ws-client.ts`) used the *same* (wrong) `encodeFrame` on
both ends, the integration suite was self-consistent and passed while the real
client could not sync. Fix: `protocol.ts` now matches the y-websocket client
byte-for-byte, and the room/client process **every** sync message in a frame
(a step2+step1 reply is one frame carrying two messages). Verified end-to-end
against the stock `WebsocketProvider` in the e2e suite.

## 3. workerd Durable-Object WebSocket quirks (integration + e2e both rely on these)

- **Close handshake is not echoed automatically.** workerd's DO socket does not
  complete the close frame on its own; the peer sees an abnormal `1006`. The
  room answers explicitly: on `close` it calls `ws.close(ev.code, ev.reason)`.
- **Sends before the 101 flush are dropped.** The room's on-connect step1 is
  deferred with `setTimeout(50)` and kept alive with `ctx.waitUntil`.
- **The client announces its own step1 on open** (mirroring y-websocket), so a
  fresh client receives the room's step2 and marks synced.

## 4. Integration tests: real `wrangler dev` instead of the vitest workers pool

The design names `@cloudflare/vitest-pool-workers` with a `SELF.fetch`
pattern. That pool runtime cannot deliver WebSocket *upgrade* frames to test
clients (verified: a pool WS client stays in `CONNECTING` forever). So
`tests/integration/global-setup.ts` boots the **same production Worker +
Durable Objects** on a local `wrangler dev` server (port 29042, inspector
29043) and the tests drive it over the network with `tests/integration/ws-client.ts`
(a faithful y-websocket client). The Worker under test is byte-for-byte the
production code; only the transport is a real TCP socket instead of the pool.
Node's undici `WebSocket` delivers binary frames as `Blob`, so the client
normalises `Blob → ArrayBuffer`. (TC-04 uses `node:http` because undici's
`fetch` rejects an `Upgrade: websocket` header.)

## 5. Test placement details (e2e)

- **Non-overlapping anchors.** Notes are 200 world units; at zoom 1 a
  double-click on occupied space edits the existing note instead of creating a
  new one. Multi-note tests therefore zoom out (`setCamera`) and place notes on
  a grid whose spacing exceeds the on-screen note size, and each editor owns a
  private row/column so concurrent editors never target the same pixel.
- **End edit mode before dragging.** `createNoteAt` leaves the note in edit
  mode (focused textarea); a subsequent drag would hit the textarea, not the
  note body. Tests press `Escape` (keeps selection) before moving/recolouring.
- **TC-27 offline detection.** Under Playwright `context.setOffline(true)` the
  browser does *not* fire the WebSocket `close`, so disconnection is detected by
  y-websocket's no-message watchdog (`messageReconnectTimeout` = 30 s). That is
  longer than `CATCH_UP_TEST_OUTAGE_MS` (30 s), so the test overlaps the
  offline edits with the detection wait rather than adding a second full
  outage. The badge still transitions `Connected → Reconnecting → Connected`
  exactly as specified.
- **TC-29 (idle) is safe.** The room relays each client's awareness *back to
  that client*, so idle sockets keep receiving traffic and the 30 s watchdog
  never fires while online — a 50 s idle probe shows zero unexpected
  `reconnecting` flips.

## 6. Board ids

`BOARD_ID_BYTES = 16` (128 bits → 22 base64url chars). The worker rejects any
id that is not exactly this shape, so tests generate 16-byte ids.

## 7. Named settings (all in `src/shared/config.ts`, as designed)

- Story 1: `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`,
  `WHEEL_ZOOM_SENSITIVITY`, `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`.
- Story 2: `STICKY_SIZE_WORLD`, `STICKY_TEXT_MAX_CHARS`,
  `STICKY_COUNTER_THRESHOLD_CHARS`, `STICKY_FONT_MAX_PX`, `STICKY_FONT_MIN_PX`,
  `DRAG_THRESHOLD_PX`, `STICKY_COLORS`, `DEFAULT_STICKY_COLOR`.
- Story 3: `MAX_CONCURRENT_EDITORS`, `LIVE_UPDATE_LATENCY_BUDGET_MS`,
  `RECONNECT_MAX_BACKOFF_MS`, `CONNECTED_CONFIRMATION_MS`,
  `CATCH_UP_TEST_OUTAGE_MS`, `E2E_EVENTUAL_TIMEOUT_MS`.

## 8. Out of scope (deliberately not built)

Stories 6 and 13–17: no presence/selection-cursor UI, no sign-in, no dashboard,
no comments, no export. The awareness channel exists only to keep idle sockets
alive and to carry no product-visible state in this story.

## 9. Story 4 — persistence decisions

- **`WranglerProcess` (e2e) must kill the whole process group.** `wrangler dev`
  spawns workerd as a *grandchild* of the `npx` we spawn. Killing only the top
  process leaves workerd holding the port, so every later “restart” silently hit
  a stale orphan (symptom: `/__test/...` returned a 500/HTML from a dead-code
  worker instead of JSON). Fix: spawn `detached: true` (child becomes the group
  leader, `pgid === pid`) and stop with `process.kill(-pid, SIGTERM)` then
  `SIGKILL`, and wait until the port actually stops answering before returning.
  This mirrors the integration `global-setup.ts`. Durable Object SQLite is
  durable per transaction, so an ungraceful kill loses no committed data.
- **Seeding via `store-append-many` leaves the running room stale.** The hook
  writes straight to SQLite and updates the hook’s own scratch doc, not the
  already-constructed room’s in-memory doc. So the persistence e2e restarts the
  process (or calls `room-reset`) after seeding, so the room rebuilds its doc
  from disk before we observe it. TC-21/TC-24 both seed → restart → compact.
- **TC-24 recovery needs `room-reset` after repair.** After `corrupt-snapshot`
  (which already resets) the room is `load-failed`; a plain `repair-snapshot`
  would only reload on a connection ≥ `LOAD_RETRY_MIN_INTERVAL_MS` (5 s) after
  the failure, and each failed reload resets that clock. We call `room-reset`
  after repair so the *next* client reconnect reloads immediately
  (`storage-failed` → reload), independent of the 5 s gate. The client
  reconnect backoff can reach `RECONNECT_MAX_BACKOFF_MS` (10 s), so the
  recovery poll uses a 30 s timeout (correctness, not speed, is under test).
- **Client recovery maps straight to `connected`.** Close 4500 →
  `load_failed` (red message, editing off). The first successful `sync` after
  `load_failed` goes directly to `connected` (no `reconnecting`/`confirmed`
  detour, no page reload); `onStatus` early-returns while `load_failed` so
  retry status events don’t clear the red badge. Other close codes (1011,
  1003, network) → `reconnecting` (board stays readable, editing on) because
  the client re-sends unsaved changes on reconnect.
- **Production hook check.** The default wrangler environment has no
  `TEST_HOOKS`, so `index.ts` never routes `/__test/...` to the hooks; requests
  fall through to the assets binding — `POST` → 405, `GET` → SPA `index.html`
  (200 `text/html`) — never `application/json`. `npm run check:production-hooks`
  builds the production client, starts `wrangler dev` (no `--env test`) on
  29046/29047, and asserts this for `store-status`, `corrupt-snapshot` and
  `repair-snapshot`, plus a sanity SPA serve.
- **TC-21 timing is logged, never asserted.** Model, browser and server share
  one machine; a 2000-note open measured ~7.9 s here (over the 3000 ms
  `BOARD_LOAD_BUDGET_MS`) and that is reported, not failed, per the task.
- **Port allocation (29040–29055).** 29040/29041 shared e2e; 29042/29043
  integration; 29044/29045 persistence e2e (`WranglerProcess`); 29046/29047
  production hook check. All servers we start pass an explicit
  `--inspector-port` in range.

## 10. Story 5 — share a board with a link

- **Deviation — `nextBoardPageState` signature.** The design gives
  `(state, result, attempt)`; that shape cannot produce
  `{ kind: 'ready', boardId }` because the reducer never knows which board it
  is checking. The implementation is `(state, boardId, result, attempt)` —
  first parameter added, everything else per design (same states, same
  backoff arithmetic, same terminal outcomes).
- **TC-09 ordering: upgrade check before existence check.** A request for an
  *unknown* board must be 404 *when it carries an `Upgrade: websocket`
  header*, but story 3 TC-05 still requires 426 for a non-upgrade request to
  a *valid* board. `fetch` therefore orders: malformed id → 404; missing
  upgrade header → 426; unknown board → 404; then the room handshake. Both
  stories hold.
- **`existsReadOnly` legacy rules (design line 45).** `true` when
  `storage_meta.created_at` exists, or (legacy) `updates` has any row, or
  (legacy) `snapshot_chunks` has any row; `false` when the board has no
  tables at all. Each table query is guarded by the table list, so a
  partially-migrated board (e.g. only `updates`) cannot crash the check.
- **workerd internal table `__miniflare_do_name`.** workerd creates this
  internal table in every DO database, so `name NOT LIKE 'sqlite_%'` would
  report *every* board as existing. `boardTables()` uses an explicit
  whitelist: `name IN ('updates', 'snapshot_chunks', 'quarantined_updates',
  'storage_meta')` (worker store and test hook share the same list).
- **Migration moved out of the constructor.** `new BoardStore(storage)` no
  longer migrates. Tables are created by `initialize()` (board creation) and
  lazily by the first `append()` to a table-less board (legacy upgrade path,
  which writes the schema version but no `created_at` — exactly the TC-08(a)
  shape). The room constructor's `load()` therefore never mutates storage; a
  table-less board loads as an *empty* board (`{ok, quarantined: 0}`), which
  is the "unknown board" case the room 404s on before the upgrade.
- **TC-12 (initialize throws → 500, nothing persisted).** Board-level
  injection can't be reached from the worker (the room is a different DO
  class instance), so `create-board.ts` exposes
  `injectInitializeForTests` (a worker-process variable) and the hook route
  `POST /__test/faults/create-board` sets `mode: 'throw' | 'exists' |
  'clear'`. The test exercises the real `POST /api/boards` handler end to
  end.
- **`raw-sql` hook op (TC-08(b)).** Seeding a *legacy* board (an `updates`
  row with no schema version, no `created_at`) is impossible through
  `store-append*` (its session migrates first). `POST /__test/boards/:id/
  raw-sql` runs one parameterized statement against the board's SQLite
  database; it is only mounted under `TEST_HOOKS`.
- **E2E: `apiCreateBoard(request, baseUrl?)` helper (helpers.ts).** Rooms no
  longer materialize on first connect, so every e2e test that opens a board
  creates it via `POST /api/boards` first. `live-collaboration` and the
  nightly soak use the shared `webServer` (the context `request` fixture's
  baseURL); `persistence` passes its own `proc.url`. The only ids still made
  raw are the ones that must *not* exist (bad-link test) and the
  hook-seeded legacy boards (persistence TC-21/24 — the seed creates their
  tables, so they are "existing" boards by data, story 4-era simulation).
- **TC-31 needs `room-reset` after seeding.** The `store-append-many` hook
  itself constructs the room (to get storage) — at that moment the board is
  empty, so the constructed room holds a stale empty doc. Same caveat as
  persistence TC-21/24: reset after seeding so the first real connection
  reloads from disk.
- **`store-status` extended, not changed.** All story 4 fields keep their
  names; added `tables: string[]` and `createdAt: string | null`. The
  integration `StoreStatus` type mirrors this.
- **Integration `global-setup` now builds the client.** Story 5's server
  serves the SPA (`/`, `/b/:id`) from `dist/client`, so the setup runs
  `vite build --mode test` before starting wrangler (same as the e2e
  `webServer`).
- **`app-load-failed.test.tsx` renders `<Board>` directly.** `App` now hosts
  the router (home page at `/`), so the story 4 "load failed" test mounts
  `<Board boardId="test-load-failed" />` — the exact same component the
  board page would mount. `canEdit` is re-exported from `App.tsx` for the
  story 4 test import.
- **TC-21 (component) fake timers.** The retry loop uses real timers in the
  test only through `vi.advanceTimersByTime`; `await act(async () => {})`
  flushes the microtask queue between advances, and assertions use `act` +
  synchronous queries (no `findBy*` — those spin their own timer loop and
  deadlock under fake timers).
- **Firefox/WebKit not covered (environment limitation).** The tasks list
  TC-27/TC-29 "in firefox and webkit too", but this machine has only
  Chromium installed (`~/.cache/ms-playwright` holds chromium builds only;
  installing other browsers is not possible offline). The Playwright config
  therefore keeps a single chromium project (extended to match
  `(live-collaboration|share)\.spec\.ts`); no firefox/webkit projects are
  declared, so no suite fails for a missing browser. The share flows are
  DOM/clipboard only (no browser-specific APIs beyond `navigator.clipboard`,
  which is exercised on Chromium), so porting is a config change.
- **Clipboard in component tests.** jsdom has no `navigator.clipboard`;
  `SharePanel.test.tsx` defines it via `Object.defineProperty` per test
  (allow / reject variants). e2e TC-26 uses a context with
  `permissions: ['clipboard-read', 'clipboard-write']` for the real API and
  reads the link back with `navigator.clipboard.readText()`; TC-29's init
  script replaces `writeText` with a rejecting promise to force the manual
  fallback and asserts `window.getSelection()` equals the full link.
- **Click→board budget is logged, never asserted** (TC-26 e2e): the
  2000 ms `CREATE_BUDGET_MS` is a UX target; the measured value is printed
  with a within/over marker.
- **No new ports.** Story 5 reuses the existing allocation (29040–29047);
  29050/29051 were used only for manual debugging during development.
