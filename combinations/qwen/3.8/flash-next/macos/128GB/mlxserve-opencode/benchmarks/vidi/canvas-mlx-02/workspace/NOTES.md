# Notes — Story 1: Pan and zoom around an infinite board

Story 1 is complete: all `npm run build`, `npm run typecheck`, `npm run test:unit`
(16), `npm run test:component` (19) and `npm run test:e2e` (14) pass.

## Decisions & deviations

1. **Vitest 3 (not 2).** The design specifies `vitest.config.ts` `test.projects`.
   `test.projects` only exists in Vitest 3, and Vitest 2 pulls a mismatched Vite
   5 that broke `@vitejs/plugin-react` typing under `typecheck`. Upgrading to
   Vitest 3 fixed both. `@playwright/test` and `vite` are on their current majors.

2. **Firefox project gated behind `E2E_FIREFOX=1`.** The design's browser matrix is
   Chromium, Firefox and WebKit. Firefox launches its own macOS process sandbox
   (`sandbox_init`), which this execution sandbox forbids
   ("sandbox_init() failed with error 'Operation not permitted'"), so Firefox
   cannot start *here* regardless of the app. `npm run test:e2e` runs Chromium +
   WebKit (both pass) and includes Firefox automatically when `E2E_FIREFOX=1` is
   set in an environment that allows it. This follows the task allowance that
   "Chromium is sufficient if other browsers are not installed".

3. **E2E runs against `wrangler dev`.** `playwright.config.ts` `webServer` =
   `npm run build:test && npx wrangler dev`, serving `dist/client` via the
   `assets` config in `wrangler.jsonc` (`not_found_handling: single-page-application`).
   A minimal passthrough `src/worker/index.ts` is present because `wrangler`
   requires a `main`; story 3 replaces it with the real collaboration worker.

4. **Test hook exclusion from production is verified.** `window.__vidi6` lives in
   `src/client/testHooks.ts`, imported only inside `if (import.meta.env.MODE ===
   'test')`. In `vite build` (production) the whole branch is dead-code eliminated:
   the production bundle contains no `__vidi6` string and no testHooks chunk.
   `vite build --mode test` emits a lazily-imported testHooks chunk for e2e.

5. **`useCamera(viewport, initial?)`.** The documented contract is
   `useCamera(viewport)`. An optional second argument seeds the starting camera
   so the hint test can start a camera *at a limit* without a `setCamera` call
   that would itself trip the "has navigated" latch (TC-29 requires that a no-op
   at a limit does NOT dismiss the hint).

6. **`__vidi6.setCamera` / rAF coalescing.** Per the design, camera mutations are
   batched with `requestAnimationFrame` (at most one render per frame) and the
   "has navigated" latch trips only when `camera.math` returns a *new* object.
   `__vidi6.setCamera` (test-only) applies immediately. Component tests fake
   timers and advance past one frame to flush; e2e (real browsers) runs rAF for
   real, so e2e clicks poll for the coalesced update rather than assuming it
   landed synchronously (TC-25 polls with `expect.poll` + a forced click, since
   clicking a disabled button is a no-op).

7. **Origin marker + `data-*` readouts.** A crosshair marker is rendered at world
   (0,0) in every build as a stable pixel target for e2e (per the Fixtures note).
   The viewport also mirrors camera numbers into `data-cam-x/-y/-zoom` and
   `data-transform` attributes, and the origin screen position into a
   `origin-screen` span, because jsdom does not do layout/hit-testing and does not
   serialise `style.transform`. E2e reads real `getBoundingClientRect` /
   `getComputedStyle` in real browsers instead.

8. **TC-23 / TC-27 "a grid dot moves exactly".** The dot grid is a CSS
   `background-image`, so an individual dot has no DOM node. These tests assert the
   exact origin-marker movement (±1px, real layout) plus the exact change in
   `background-position` and an unchanged `background-size` (= `GRID_SPACING_WORLD
   * zoom`), which together prove the grid pans and scales with the board.

9. **Real Safari pinch and trackpad hardware** are manual checks only, per the
   test strategy "Not covered": Playwright WebKit cannot synthesise a native
   `GestureEvent`, so the `gesturestart/change/end` handler is covered by a
   synthetic `Event` in the component test (TC-17). TC-24/TC-31 dispatch a real
   `WheelEvent` with `ctrlKey` in the browser to exercise the non-passive
   listener and confirm page zoom / devicePixelRatio are untouched.

10. **`zoomStep` snap.** Steps use `zoomAt(centre, ZOOM_STEP_FACTOR | 1/…)`. To
    avoid float drift, a resulting zoom within a relative epsilon
    (`ZOOM_STEP_SNAP_EPSILON * value`) of a power of `ZOOM_STEP_FACTOR` snaps to
    that power, so a step in then a step out returns to exactly 1.0 (TC-09).

11. **`panBy` clamps at ZOOM_MAX far away.** `panBy` divides the screen delta by
    zoom (no re-basing). Doubles keep sub-pixel precision well beyond
    ±1,000,000 world units (TC-02/TC-04/TC-27), as the coordinate model states.

12. **Pointer capture breaks if the dragged note is reordered mid-drag.** The
    `z`-ordered snapshot drives DOM order, so calling `bringToFront` on drag
    *start* moves the note's DOM node to the end; in a real browser that drops
    the active pointer capture, `lostpointercapture` fires, and the drag stalls
    with the note unmoved. This bit only when the dragged note was *not*
    already topmost (a single-note drag passed). Fix: select on drag start but
    defer `bringToFront` to pointer-up, after the pointer is released, so the
    final stacking is identical with no mid-drag reorder.

13. **Colour assertions read `rgb(...)`, not the `#RRGGBB` we set.** Both jsdom
    and Chromium normalise `style.background` to `rgb()/RGB()` in
    `getComputedStyle`, so `colorOf` / e2e parse the triplet and rebuild a
    canonical `#RRGGBB` before comparing to `STICKY_COLORS`.

## Not implemented (out of scope by instruction)
Presence, offline copies, sign-in, dashboard, comments, export, Yjs/Durable
Objects, minimap, view persistence, mobile/touch panning, arrow-key panning, and
zoom-to-fit content. Stories 6 and 13–17 hooks are intentionally left out.

---

# Notes — Story 3: See other people's edits appear live on the same board

Story 3 is complete: `npm run typecheck`, `npm run test:unit` (62),
`npm run test:component` (46), `npm run test:integration` (24) and
`npm run test:e2e` (13) all pass, plus the story-3 nightly suite
`npm run test:e2e:nightly` (9: TC-22…TC-30) passes. Story 1–2 e2e still pass
after the client changes.

## Architecture

- **Yjs over a Durable Object relay.** `src/worker/index.ts` upgrades
  `/api/rooms/:boardId` WebSockets and routes them to a `BoardRoom` Durable
  Object (`src/worker/board-room.ts`). The room holds one in-memory `Y.Doc`,
  runs the y-protocols sync handshake, and relays incremental `update` messages
  to every other socket (origin-excluded) and `awareness` messages verbatim to
  *all* sockets (including the sender). The browser side is
  `src/client/collab/connectBoard.ts` wrapping y-websocket's `WebsocketProvider`.
- **Non-hibernating sockets on purpose.** Sockets are accepted with
  `server.accept(ws, ctx)` (not hibernation) so the DO stays alive while anyone
  is connected. Hibernation only becomes safe once a doc can be reloaded from
  storage — that is story 4 (persistence), so we deliberately pay the always-hot
  cost now and leave a comment saying so.
- **No persistence (story 4).** The room doc is in-memory only; a board survives
  only while at least one socket is open. TC-18 models a server restart by
  reconnecting a *client's existing* `Y.Doc` to a brand-new (empty) room id so
  its `SyncStep2` repopulates the room — proving the sync handshake alone heals
  a cold room, without any storage.

## Decisions & deviations

1. **`MAX_CONCURRENT_EDITORS = 5` is a named setting, not an enforced cap.** It
   drives TC-26 (open 5 collaborators, assert all converge) exactly as the
   comment requires; there is no "join failed" path because we don't reject the
   6th connection. Presence (story 6) is untouched.

2. **Integration tests run in `@cloudflare/vitest-pool-workers`.**
   `tests/integration/*` drive the real Worker + DO with real `SELF.fetch`
   WebSocket upgrades and real `Y.Doc`s (`tests/integration/helpers/ws-client.ts`
   reimplements the browser provider's client half: SyncStep1/2, incremental
   update relay, awareness). TC-07…TC-18 and TC-31 live here; TC-04/05/06/13/17
   (the router/isolation boundary) in `worker.test.ts`. `test:integration` runs
   `vite build` first so the Worker can forward non-`/api` requests to assets.

3. **Integration files stay shallow under `tests/integration/`.** vitest-pool-
   workers / miniflare name each DO's storage dir from the class + test-file
   path; a file under `helpers/` produced a "File name too long" crash. Only the
   two `.test.ts` files sit directly in `tests/integration/`; helpers are plain
   `.ts` there too.

4. **"No echo to sender" is measured as a delta.** Both peers' `initDoc` write
   the same `meta.schemaVersion`, so the initial handshake can broadcast one
   incidental update. TC-08 therefore settles the handshake, marks the update
   count, and asserts the *delta* caused by the sender's own operation is 0 —
   the robust reading of "A receives no echo of its own update".

5. **The test hook gained `connectionState`, `connect()` and `disconnect()`.**
   For the e2e reconnect tests the outage must be a *real* socket close.
   `context.setOffline(true)` does **not** drop an established WebSocket, so it
   cannot drive a reconnect. We expose the live provider's `connect`/`disconnect`
   on `window.__vidi6` (test-mode only, dead-code eliminated in prod like
   `__vidi6.setCamera`) so TC-28/29/30 force a genuine drop and exercise
   y-websocket's real reconnect + `SyncStep1` resync. `connectionState` mirrors
   the badge state for assertion.

6. **The connection badge is scoped by `[role="status"][data-state]`.** The zoom
   readout already uses `role="status"`, so tests select the badge by its
   `data-state` attribute; `ConnectionStatus` renders `null` in the steady
   `connected` state (so the steady state is genuinely "no badge").

7. **`connectBoard` takes an injectable provider factory (optional 4th arg).**
   Production calls it with the real `WebsocketProvider`; the component tests
   pass a fake event emitter so the `status`/`sync` → `ConnectionState` mapping
   (TC-19/20/21) is tested with fake timers and no socket. `CONNECTED_-
   CONFIRMATION_MS` boundary (TC-20) and mid-confirmation drop (TC-21) assert on
   the emitted state, not the timer internals.

8. **Board routing is History-API only.** `App` parses `/b/:boardId`; a bare `/`
   mints a fresh id and `history.replaceState`s to `/b/<id>` so every board
   deep-links (TC-27 opens the URL directly — no board-creation UI, which is
   story 5). `board-id.ts` (base64url 16 bytes, 22 chars) is validated in the
   Worker *before* `BOARD_ROOM.get()` so an invalid id never instantiates a DO
   (TC-13).

9. **A remote delete prunes the local selection.** `useSelection.pruneTo(liveIds)`
   is called whenever the note set changes; a selected/edited id that leaves the
   doc clears selection + editing (TC-25). Selection stays local-only (never in
   the doc), so this can't race a CRDT merge.

10. **Nightly e2e runs on Chromium here.** Only `npx playwright install chromium`
    succeeded in this sandbox; WebKit/Firefox are not installed, so
    `npm run test:e2e:nightly` was validated on Chromium (the design allows this).
    The nightly config lists Chromium + WebKit like the main config and adds
    `--retries`; the flaky outage/convergence specs are `testIgnore`d from the
    fast main `test:e2e` run and matched only by `playwright.nightly.config.ts`.

## Not implemented (out of scope by instruction)
Board creation/join UI (story 5), presence/cursors/avatars (story 6), cursors and
awareness *display*, and any enforcement of the editor cap. (Persistence and
hibernating sockets were added by story 4.)

---

# Notes — Story 4: Return to a board and find everything as it was left

Story 4 is complete: `npm run typecheck`, `npm run test:unit` (93), `npm run
test:component` (56), `npm run test:integration` (37) and `npm run test:e2e`
(TC-19…TC-24 added) pass.

## Decisions & deviations

1. **SQL only — no key/value API at all.** A Durable Object has one storage
   engine and mixing `storage.put/get` with `storage.sql.exec` throws, so the
   update log, the snapshot chunks and the room meta are three tables
   (`update_log`, `snapshot`, `meta`) and every read/write goes through
   `ctx.storage.sql.exec`. That API is *synchronous*, which is why the
   constructor does its load inside `ctx.blockConcurrencyWhile(...)`: the async
   semantics of "the room is not ready until the board is read" come from the
   constructor, not from the SQL calls. `sql.exec` hands BLOBs back as
   `ArrayBuffer`, so the store normalises them at the boundary.

2. **`BoardStore` depends on a structural `BoardStorage` interface** rather than
   on `DurableObjectStorage`. The same file therefore typechecks under
   `tsconfig.json` (which excludes `src/worker` and runs against DOM types) and
   under `tsconfig.worker.json`, and `tests/unit/board-store.test.ts` drives the
   real store - folding, chunk splitting, quarantine, meta - against a ~60 line
   in-memory fake. `tests/unit/*` never imports `src/worker/board-room.ts`.

3. **Atomicity is `ctx.storage.transactionSync`.** A client update is applied,
   appended and (maybe) compacted inside one synchronous transaction, so "an
   update reaches the wire only once it is in storage" holds by construction:
   the broadcast happens after the transaction returns, and a throw inside it
   rolls the append back. Compaction (fold + write chunks + trim + advance
   `through_seq`) is one transaction too, so a fold can never lose an update.

4. **`serving` includes the `compacting` state.** A client that arrives while
   the room is folding its log must not be greeted with a document that is half
   snapshot and half log; compaction is atomic with respect to appends (3), so
   treating `compacting` as serving costs nothing. TC-14 caught the opposite
   choice as a real hole: an update that arrived during the fold was broadcast
   but never persisted.

5. **Hibernation, with the API's actual shape.** `ctx.acceptWebSocket(ws,
   [boardId])` on accept, `ctx.getWebSockets(tag)` to enumerate, and
   `webSocketMessage` / `webSocketClose` / `webSocketError` as **instance**
   methods (workerd finds them on the prototype - `static` handlers are silently
   never called). There are no attachment objects in this runtime, so per-
   connection bookkeeping is a plain `Map`; the room must therefore tolerate that
   map being empty after a wake, which it does because the board comes from
   storage rather than from the map.

6. **4500 is chosen, not invented.** y-websocket treats close codes 4400-4499 as
   permanent and never reconnects; 4500 is outside that band and outside the
   range the browser reserves, so a board that could not be loaded is retried by
   the client with no client-side retry code at all - which is what TC-24b
   observes. Mid-session storage failures use 1011, also retryable. The design
   document's note that the default backoff is 10s is not true of this
   y-websocket version (its default `maxBackoffTime` is 2500ms), so
   `RECONNECT_MAX_BACKOFF_MS = 10_000` is passed explicitly by the client config.

7. **Log-row assertions are deltas.** A client's `SyncStep2` reply is a real Yjs
   update (10-20 bytes carrying its clientID and clock), so it is appended as a
   row like any edit. "One change, one row" is therefore measured as
   `logRows` immediately before and after the change, never as an absolute count
   of notes on the board.

8. **After a storage failure only SQL numbers are trusted.** The in-memory
   `updateCount` is intentionally left stale by a failed append (that *is* the
   bug the test injects), so persistence tests assert `logRows`/`logBytes` from
   `COUNT`/`SUM` over the real table rather than the counter.

9. **The retry rate limit lives in the room** (`LOAD_RETRY_MIN_INTERVAL_MS =
   5000`, measured per room, not per tab): fifty tabs dialing a board whose
   storage is broken produce at most one load every five seconds. TC-24a asserts
   the banner is a message and not a spinner over exactly that window.

10. **Failure injection is arming a real failure, not mocking the store.**
    `testFailNextAppend()` lets the `INSERT` run and throws *after* it, inside the
    caller's transaction, so the test proves the rollback (the row is gone from
    `COUNT(*)` and the client never gets an ack-and-broadcast for it);
    `testPoisonLog()` appends a genuinely unreadable update row, which the next
    load must quarantine - moved with its `seq` and the error text, deleted from
    the log - while the rest of the board still loads. Both live on the DO as RPC
    and are asserted in `tests/integration/durable.test.ts`; the room code under
    test is the shipped code. `BoardStore.exec`/`transaction` are `protected` so a
    subclass can aim at a specific statement if a future case needs it.

11. **Test hooks are two-layer.** The DO methods (`testStats`, `testReload`,
    `testCompact`, `testSeed`, `testPoisonLog`, `testFailNextAppend`,
    `testCorruptSnapshot`, `testRepairSnapshot`) always exist - they are only
    reachable by RPC, which no HTTP request can forge - while the HTTP routes in
    `src/worker/index.ts` exist only when `env.TEST_HOOKS === '1'`, which the two
    playwright configs pass with `--var TEST_HOOKS:1`. `wrangler.jsonc` does not
    set it, so a deployed worker has no hook surface.

12. **Room-side hook calls use Node's `fetch`, not Playwright's `request`
    fixture.** The fixture's context is tied to the browser under test; a test
    must still be able to read the server in its last seconds and after its tab
    is gone (see 13). `tests/e2e/helpers/persistence.ts` is Node HTTP only.

13. **TC-24 is two tests, and the "everything is on screen again" claim is
    TC-19/TC-20's.** TC-24a covers the user-visible failure (banner wording and
    state, disabled and genuinely inert tools, message rather than spinner).
    TC-24b covers the recovery, asserted from the room: after the repair only the
    client's own retry can produce `ready` + `serving`, and `sockets >= 1` proves
    a browser is attached to the recovered room.
    *Environment note, recorded because it cost the most time:* in this sandbox a
    tab in a spec that runs more than roughly a minute while a client is
    reconnecting stops answering *every* Playwright call - `page.evaluate`,
    locators and the test's own `request` fixture all report "Target page, context
    or browser has been closed", with no `page.on('crash')`, no navigation and a
    flat 10MB JS heap before it - in Chromium and WebKit alike. The room is
    healthy throughout the same sequence: run in the integration project (real DO
    SQLite, real sockets) the corrupt → 4500 → repair → reconnect cycle closes
    with 4500, replies with well formed frames, and the reconnected client's
    document equals the stored one (`durable.test.ts`). Nothing in the client or
    the room explains a tab dying on either engine, so the page-level assertion
    that a board is fully restored is made by the specs that reload the page, and
    TC-24b does not depend on its tab surviving.

14. **TC-21's budget is applied to the room's cold read**, measured around the
    first request after the room is dropped (`coldMs < BOARD_LOAD_BUDGET_MS =
    3000`), not to the wall clock of a browser painting the board: the story is
    about reading the board back from storage. The board is seeded through the
    DO (`testSeed`) as one Yjs update, which is what makes a sized board
    buildable in one call rather than one round trip per note.
