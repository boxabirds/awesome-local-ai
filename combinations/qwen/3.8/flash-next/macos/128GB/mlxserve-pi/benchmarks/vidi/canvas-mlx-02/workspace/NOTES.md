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

---

# Notes — Story 5: Share a board with others using a link

Story 5 is complete: `npm run typecheck`, `npm run test:unit` (132),
`npm run test:component` (80), `npm run test:integration` (65), `npm run test:e2e`
(48 across Chromium + WebKit, share.spec 7 per browser) and
`npm run test:e2e:nightly` (20) pass.

## Decisions & deviations

1. **A board exists when its storage says it exists.** `BoardStore.existsReadOnly()`
   answers "is there a `created_at` in `meta`, or a row in `update_log` or
   `snapshot_chunks`", reading `sqlite_master` first and never creating a table:
   a check that could not help creating the board is the only check that can be run
   against a link a stranger typed. The two limbs are not redundant — story 4's
   boards have rows and no `created_at`, and an empty board made today has
   `created_at` and no rows. `existsNow` on the room caches the answer once it has
   been true, because boards are never deleted in this product, so re-reading
   storage on every reconnect buys a read and nothing else.

2. **Creation is an RPC that answers "created" or "exists", never both.**
   `BoardRoom.initialize()` runs `migrate()` + `setCreatedAtIfAbsent()` inside one
   `transactionSync`, so two requests for the same code cannot both be told they
   made the board. `BoardStore.migrate()` no longer runs on construct: `load()`
   treats missing tables as an empty board, `append()` migrates lazily. That is what
   lets a board written before this story — rows, no `created_at` — still be a board
   at its address (e2e TC-32 seeds exactly that shape through the `seed` hook, which
   never writes `created_at`).

3. **Room `fetch()` order: test hooks, 426, 404, accept.** The existence gate sits
   *after* the Upgrade check so story 3's TC-05 (426 for a well-formed code that
   nobody created, asked without an Upgrade header) still reads as it did: an
   ordinary HTTP request to the room route is refused for being not-a-upgrade, not
   for being unknown.

4. **The rate limiter is the binding's real shape.** `wrangler.jsonc` carries
   `binding:"BOARD_CREATE_LIMITER", simple:{limit:10, period:60}` — the `simple`
   nesting, not a flat pair — and the visitor is `cf-connecting-ip` falling back to
   `unknown-visitor`, because a local `wrangler dev` has no `cf` object and a test
   that cannot choose its visitor cannot test a per-visitor limit (see 12).
   Collision retries are bounded twice: `CREATE_ID_MAX_ATTEMPTS = 3` tries and
   `CREATE_BUDGET_MS = 2000` of wall time, then a 500 that `createResponse()` turns
   into the PRD's sentence.

5. **`create-board.ts` declares its own structural types** (`RoomStub`,
   `RoomNamespace`, `Limiter`) rather than importing `Env` from `./index.ts`, so
   `tests/unit/create-board.test.ts` typechecks and runs under the DOM tsconfig
   without worker globals in scope. The same reasoning as story 4's
   `BoardStorage` interface: the shipped code is the code under test.

6. **Navigation is the History API, not a reload.** The design's literal
   `location.pathname =` was replaced with `history.pushState` plus a
   `vidi6:navigate` event that `useRoute()` listens for. The address bar, the back
   and forward buttons and a pasted link behave the way the acceptance criteria say
   they must either way; a reload throws away the document to fetch a document that
   is already running, and it cannot be asserted in jsdom. `routeKey()` keys the
   board page by its code, so a different code is a new page with nothing left over
   — no check in flight, no copy message, no Y.Doc.

7. **PRD sentences are pinned character for character** in
   `tests/unit/copy-wording.test.ts`, including the two that look interchangeable:
   being told to wait is not being told the board could not be made, and a link
   check that cannot reach the service says "Couldn't reach vidi6. Retrying…" rather
   than anything about boards.

8. **"Link copied" is the button's own text**, with the PRD's tick drawn by CSS on
   `[data-copied]` (so the words the button says are exactly the PRD's words), and
   the panel's message slot stays empty on success and holds only "Press Ctrl+C
   (Cmd+C on Mac) to copy" after a clipboard that refused. The two sentences are
   never both on screen: a checkmark over a link that never went anywhere is the
   failure this story exists to avoid. `copyFeedbackMessage()` therefore returns null
   for `copied`, and the component tests read `panelHarness().copyClaim()`, which
   looks at whichever of the two is holding the claim.

9. **A clipboard that refused hands the text over, and the panel is dismissed.**
   `manual` focuses the field and selects the whole address, so the keystroke in the
   sentence is enough; Escape and any pointerdown outside the panel close it, focus
   returns to the Share button, and a note being edited keeps its own Escape
   (`.sticky-editor` is exempted). A `generation` ref is bumped whenever the panel
   closes or is shown another board, so a copy that answers afterwards is dropped
   rather than drawn on a panel that no longer refers to it.

10. **The not-found page's button is the create action**, per the design
    ("reuses HomePage's create action"): the same `useCreateBoard` hook and the same
    in-flight guard, so the page that says a link is nobody's board can make a board
    that is somebody's, at a different address (e2e TC-30 clicks it). The page still
    cannot join, retry into, or write anything at the link it is about.

11. **`BoardApp` was cut out of `App`.** `src/client/App.tsx` is now only the router
    (route → HomePage / BoardPage / NotFoundPage); the canvas, toolbar, zoom,
    connection badge and Share panel live in `src/client/board/BoardApp.tsx`, which
    the story 1–4 component tests drive directly. `ConnectionStatus` moved to
    `right: 108px` so the Share button does not sit on it.

12. **`POST /__test/boards/:id/ensure` is the e2e fixture for "a board at a code the
    test chose".** The product's own endpoint returns a code the test is not told in
    advance — right for a visitor, useless for a test that must point a second
    browser, or a second worker process, at a board it already has an id for. All the
    story 1–4 specs assumed a room spins up the moment someone dials a code, so
    `openBoard()`/`gotoBoard()` ensure the board first; `persistence.spec`'s own
    worker needs `ensureBoard(id, worker.origin)` — sending the ensure to the *shared*
    worker left that spec waiting ten minutes for a board its own process had never
    heard of, which is how the change was caught rather than hidden.

13. **`route.continue({headers})` did not deliver the limiter's client address** in
    Chromium; `route.fetch()` + `route.fulfill()` does. e2e TC-29 therefore sends the
    page's own create request on with a visitor address of the test's choosing
    (`203.0.113.x`), exhausts that visitor's minute with ten POSTs, and then asserts
    the page's answer: the PRD's sentence in its slot, the button a button again, no
    board, no board address, and — the part that is easy to get wrong — not the
    not-found page either.

14. **WebKit is told what is not being checked.** It grants neither
    `clipboard-read` nor `clipboard-write` and offers no way to read the clipboard
    back, so e2e TC-27 asserts the page's own claim (`[data-copied]`, and that the
    field holds the address the page is standing at) and pushes a test annotation
    saying the clipboard itself is unreadable there, instead of pretending.

15. **Two naming constraints, recorded because they cost time.**
    vitest-pool-workers does not resolve `extends` in a wrangler config, so the
    integration project runs on the shipped `wrangler.jsonc` and reaches DO storage
    through `runInDurableObject` (+ `store.testQuery()`, `room.testSeed()`) rather
    than a duplicated test config that would drift. And the integration file is
    `tests/integration/api.test.ts`: miniflare names a DO's storage directory after
    the test file path plus class name, and macOS caps one path component at 255
    bytes — a longer name fails to start the DO, with an error about filenames.

---

# Notes — Story 7: Select, move, resize and delete several objects at once

Story 7 is complete: `npm run build`, `npm run typecheck`, `npm run test:unit`
(179 across 16 files), `npm run test:component` (132 across 17 files),
`npm run test:integration` (65) and `npm run test:e2e` (58 across Chromium +
WebKit, selection.spec 5 per browser) pass. Story 1–5 suites pass unchanged,
including every story-2 sticky-note test that drives a note by dragging it.

## Decisions & deviations

1. **Selection lives in a reducer, and in a ref next to it.** `useSelection` holds
   `{ids: Map<string, boolean>, editingId}` in `useReducer` state — the actions the
   design names (`click`, `toggle`, `setMany`, `clear`, `prune`) are pure and take
   the snapshot as an argument, so TC-13 to TC-15 test them without React. The same
   state is mirrored into a ref on every render because gesture handlers are long
  -lived closures that must read "is this id already selected?" at pointerdown
   without re-subscribing to the doc on every selection change.

2. **Pruning listens to the doc, not to React.** An `observeDeep` on the objects
   map dispatches `prune` with the surviving ids, so a note a colleague deletes
   leaves the selection the moment the update lands rather than at the next render.
   A pruned `editingId` ends editing with it. Local deletes prune through the same
   path: `observeDeep` fires for local transactions too, so nothing calls a
   `refresh()`.

3. **`SelectionBar` takes three props the design's contract does not have.**
   The design fixes it at `{ids, snapshot, onDelete}`. `camera` was added because
   the bar floats above the selection's box in screen space and must be told where
   that box is; `onColor` because story 2's `NoteToolbar` recolours the single
   selected note and the bar hands it that callback; `editing` because story 2's
   rule that nothing floats over a note you are typing into applies to the count
   bar as much as to the note toolbar. With one sticky selected the bar renders
   `NoteToolbar`, exactly as designed, which is why the e2e reads selection from
   `data-selected` on the objects instead of from `[data-testid="selection-count"]`:
   TC-32 and TC-35 were first written against the bar's number, passed nothing at
   all, and were measuring a bar that was never meant to be there.

4. **`SelectionOverlay` draws more than the outlines the design assigns it.** It
   owns all selection geometry: per-object outlines, the one bounding box for a
   multi-selection, and the 8 handles the design mentions only in the bar's prose.
   It renders in screen space through `worldToScreen` rather than inside the world
   layer, so handles keep their pixel size at every zoom level and the container is
   `pointer-events: none` with the handles switched back to `auto`. Outlines carry
   `data-object-id` and `data-selected` like the objects do, so a test can ask the
   board what is selected without knowing which components drew it.

5. **`StickyNote` answers two prop shapes.** Story 2's component tests mount notes
   with the old props (`note`, position, callbacks) and the task forbids rewriting
   them; the board mounts the same component through the generic `ObjectProps`
   path, which adds `data-object-id`, `data-selected`, `data-editable` and
   `width`/`height` rendering, and delegates pointerdown to the gesture hook.
   `data-editable` marks the contenteditable element the overlay must not paint over
   while text is being typed.

6. **Registration happens at module load, not through a `registerBuiltinTypes()`.**
   `src/client/objects/registry.tsx` registers `sticky` as it is imported, the way
   story 2 already worked, so nothing has to remember to call an init function and
   the object type cannot be rendered without its spec. `board-model.ts` keeps the
   two-tier split the design needs: `registerReadableType` for the type names the
   document may contain, `registerObjectType` (which calls it) for a React spec.
   A type nobody registered is invisible to `allObjectIds`/`objectsInRect` and never
   moved, resized or deleted by a selection action — forward compatibility with
   types this story has not heard of.

7. **A creation that opens an editor parks the id.** `createSticky` writes to the
   doc and the click handler then wants to select and edit that id, but the snapshot
   in that same closure predates the write, and the reducer correctly refuses
   actions for ids it cannot see. `BoardApp` therefore parks the new id in a
   `pendingEdit` state and a `useEffect` calls `startEdit` once the object appears
   in the snapshot. Without this, note creation appeared to work in jsdom (which
   re-reads the doc between the events a real browser delivers in one frame) and
   would have opened no editor on a real board.

8. **Gesture frames are rAF-throttled and flushed, including on cancel.** Move and
   resize write absolute rects from the gesture's baseline (`start + delta`), one
   frame per `requestAnimationFrame`, and the pending frame is applied synchronously
   on `pointerup` *and* on `pointercancel`. "Last applied state kept" means the note
   freezes where the pointer last put it, which is the flushed frame, not the
   position from before it: story 2's TC-21 asserts exactly that for a single drag.
   `onGestureEnd` is not announced for a press that never crossed
   `DRAG_THRESHOLD_PX`, because that was a selection, not a gesture, and story 8
   will draw undo boundaries from these callbacks.

9. **`bringObjectsToFront` fires at gesture start, and only for moves.** A move
   raises the whole selection above the notes it is not made of, once, at the moment
   the drag starts; a resize reorders nothing. The call only ever raises, so a note
   that was already topmost stays a no-op as in story 2.

10. **Marquee is Shift, and nothing else.** A plain drag on empty space still pans,
    exactly as in story 1; `BoardViewport` starts a marquee only when the pointerdown
    lands on the viewport itself *and* Shift is held. Marquee selection is additive
    (`setMany(ids, true)`), so a test that wants a rectangle measured on its own has
    to clear first — the reason `clearSelection()` exists in `selection.spec.ts`.
    Escape during a marquee discards it and leaves the selection untouched, which is
    also why `useBoardKeys` takes an `escapeBlocked()` guard: the board's own Escape
    shortcut must not fire in the same keystroke.

11. **`clampScale` clamps uniformly when the two axes agree.** The design's snippet
    clamps each axis independently, which silently shears an aspect-locked selection
    that hits `MAX_OBJECT_SIZE_WORLD` on one axis only. When `sx === sy` (the case a
    sticky resize produces) the single scale is clamped once instead, so a note that
    is square at the limit stays square.

12. **`resizeObjects` returns the rects it wrote and there is no rollback helper.**
    The design's file list contains no `restoreObjectsBounds`, so the gesture hook
    keeps each object's start rect in its own closure and never writes a rect it did
    not compute from that baseline. `objectBounds` and `objectsInRect` work off the
    registry rather than `if (type === 'sticky')` branches, which is what keeps the
    board model type-agnostic as it grows.

13. **Two settings the design's table does not list**: `STICKY_MIN_SIZE_WORLD` and
    `MAX_OBJECT_SIZE_WORLD` are the floor and ceiling the story's own acceptance
    text asks for (a note you cannot shrink below the text you typed into it, a
    selection you cannot inflate past the board), and `NUDGE_STEP_WORLD` /
    `NUDGE_LARGE_STEP_WORLD` are 1 and 10 world units. Shift+arrow is the large
    step; Ctrl/Cmd+arrow is not a second size (TC-29), and arrow keys never pan the
    camera. Delete, Backspace and Escape all call `preventDefault()` — Backspace
    would otherwise navigate back a page.

14. **E2E asserts geometry, not implementation.** TC-33 first asserted "the box
    corner lands under the pointer", which is true of a free resize and false of an
    aspect-locked one: the axis pulled further for its own length sets the scale and
    the other follows the shape. The test now asserts that one axis received exactly
    the drag it was given, the other deliberately did not, and the two ratios agree.
    `tests/e2e/selection.spec.ts` also verifies that any pointer point it uses is
    clear of the toolbar, zoom control and share button, because a click that lands
    on chrome is a mystery failure at 1 a.m.

15. **`tests/fixtures/testbox.tsx` is excluded from `tsconfig.worker.json`.** It is a
    React object type used by the component and unit suites, and it sits in
    `tests/fixtures`, which the worker program includes; a program whose `lib` is
    `["ES2022"]` with no DOM then reported every `src/client` component as not
    knowing what `document` is. The client program (`tsconfig.json`, which includes
    `tests/`) is where that fixture is typechecked; the exclusion is the file, not
    the directory, so the integration fixtures stay in the worker program.

## Not implemented (out of scope by instruction)

Permanent groups and grouping/ungrouping, lock, align, distribute, snap and smart
guides (the PRD's out-of-scope list), "move to front / move to back" buttons,
rotation handles and a lasso, per-object nudging, marquee without Shift, marquee
that intersects rather than encloses, and typing together into one note. Selection
is local per client and is never written to the Y.Doc.

# Notes — Story 8: Undo and redo my own changes, without undoing anyone else's

Story 8 is complete: `npm run typecheck`, `npm run test:unit` (203), `npm run
test:component` (148), `npm run test:integration` (65) and `npm run test:e2e` (58)
pass, and the three new scenarios pass under the nightly config on Chromium and
WebKit (`npm run test:e2e:nightly -- undo.spec.ts`, 6). The story itself is
24 unit, 16 component and 3 end-to-end tests.

## Decisions & deviations

1. **"My changes only" is an origin filter, not a user filter.** The controller is
   `new Y.UndoManager(doc.getMap('objects'), { trackedOrigins: new Set([LOCAL_ORIGIN]) })`.
   `LOCAL_ORIGIN` is the `unique symbol` `board-model` wraps every local mutation in,
   so a colleague's change (the provider's origin) and story 4's `LOAD_ORIGIN` (the
   board as it was read back from storage) are outside the scope by construction —
   there is no code path by which they could be stepped back. There is no user id
   anywhere in the history: one tab is one person, five tabs are five histories.

2. **The controller is created by `BoardApp`, not `App.tsx`.** The task's file list
   puts it in `App.tsx`, but `App.tsx` never sees a `Y.Doc`: `useBoardDoc` opens the
   doc, and the doc and the history over it have to be born and die together (the
   controller holds listeners on the doc, and `destroy()` is what drops the history,
   which is what makes it session-only). `BoardApp` creates one per doc in a ref
   keyed by the doc identity, destroys it on unmount, and hands it down through
   `UndoContext` — a context rather than a prop because `StickyTextEditor` needs it
   and every object type would otherwise have to accept an `undo` prop it never uses.

3. **The controller owns its capture window rather than trusting yjs's.** yjs merges
   tracked transactions while the gap between them is under `captureTimeout`, which is
   right for typing and wrong for two unrelated clicks half a second apart. The
   controller passes the timeout through *and* rearms its own `setTimeout(closeWindow)`
   on every captured change, so a window closes exactly `UNDO_CAPTURE_TIMEOUT_MS`
   after the last write of a burst, and `boundary()` closes it now. TC-13 tests both
   boundary values against the real clock: a pause of exactly `UNDO_CAPTURE_TIMEOUT_MS`
   is two steps, one millisecond short is one. (`vi.useFakeTimers()` cannot be used
   here: yjs's captureTimeout reads `lib0/time`'s `getUnixTime`, which is `Date.now`
   by direct reference, so the tests wait real milliseconds — a whole test file takes
   ~300 ms.)

4. **The undo stack trims from the front on `stack-item-added`, not on pop.**
   `while (undoStack.length > maxSteps) undoStack.shift()` — the oldest *action*
   leaves and the board itself is untouched. The redo stack is left alone: it is
   bounded by the undo stack it came from.

5. **An undo that found nowhere to land is announced anyway, and that is a bug the
   end-to-end test caught.** If a person moves a note and a colleague deletes that
   note, the inverse of the move has nowhere to go: yjs pops stack items until one
   performs a change, finds the last one deleted, and returns `null` **without firing
   a single event** — no `stack-item-popped`, no `stack-cleared`. Every listener was
   therefore left holding the state from before the press, and the toolbar's Undo
   button stayed enabled, offering a step that no longer existed, for as long as the
   person kept pressing it. `manager.undo()` is now followed by an unconditional
   `notify()`, because the controller is the only place that knows the truth. Guarded
   twice: `undo-history.test.ts` ("tells its listeners about the undo that found
   nowhere to land") at the model, and `UndoControls.test.tsx` ("greys the control
   once the step it offered has nowhere left to land") through the real keystroke and
   the real button — the component test does fail when the `notify()` is removed.

6. **`useUndo` keeps a version counter, not a snapshot of the stacks.** The stacks
   live outside React; the hook subscribes to `onChange` and bumps a number, and
   `canUndo`/`canRedo` are read at render time from the controller. A hook that stored
   booleans would have to remember to update both, in both directions, on every one of
   the five yjs events.

7. **The boundaries wired in are before *and* after each single model call.**
   `boundary()` is `stopCapturing()`: called before a call it closes the previous
   window, called after it closes its own. This is why `useBoardKeys` wraps Delete and
   the arrow nudge, `Toolbar` wraps create, `NoteToolbar` wraps colour and delete, and
   `useTransformGesture` gets it as `onGestureStart`/`onGestureEnd` (including
   `pointercancel`). The one that earns its keep is the boundary around Delete:
   selecting eight notes is itself eight local writes (a click raises a note's `z`),
   and without the boundary one Ctrl+Z would take back the delete *and* the clicking.

8. **Typing into a note and creating that note are two steps, by design and by
   accident.** `StickyTextEditor` calls `boundary()` on mount and on cleanup, and
   intercepts Ctrl/Cmd+Z and Ctrl+Shift+Z inside the textarea so the browser's own
   textarea undo never diverges from the `Y.Text`. TC-22 asserts the consequence on
   two screens: a colleague's first Ctrl+Z empties the *words* of their note and the
   second takes the *note*.

9. **The e2e scenarios run under the nightly config.** They open 2 and 5 browser
   contexts and assert convergence, like the story 3 specs, so `undo` was added to
   `playwright.config.ts`'s `testIgnore` and to the nightly `testMatch`; the file sets
   `test.setTimeout(180_000)` over the nightly's 60 s for the five-context case.

10. **Fixture geometry is part of the test.** Every one of the twelve notes of
    `buildRetroBoard()` (eight in a cluster, four scattered) lies wholly inside the
    1280×800 viewport at the reset camera, and the notes the e2e creates are pinned at
    x = 160, 560, 960 — short of the bottom-right corner, where `zoom-controls` sits
    and would eat the double-click. `page.mouse.click(x, y)` with x past the viewport
    does not fail, it does nothing, which turns a geometry mistake into "the delete
    never happened" at 1 a.m. `tests/e2e/selection.spec.ts` already had this rule; the
    undo spec follows it.

11. **A note's screen position is not stable after a move, so the scenarios move
    notes towards the middle.** TC-23 drags by (−160, +60) rather than the obvious
    (+140, +40): a note pushed off the right edge is unclickable on the *other*
    person's screen, and the assertion that fails is three actions later.

12. **Reading one's own new note back needs the place it was made, not "whichever
    note appeared".** With five people pinning notes at the same moment, the note that
    appeared between two readings may be a colleague's that arrived from the server in
    between. `onlyNew(before, after, at)` filters on the world coordinates of the spot
    the page double-clicked, computed from `resetCam()` and `STICKY_SIZE_WORLD`.

13. **`addScope` exists and is unused.** It is `manager.addToScope` for story 16's
    comments map. The controller does not call it for anything today.

## Not implemented (out of scope by instruction)

Per-user identity in the history (origins do the work), undo of a *collaborative*
change or of another person's change, cross-tab or cross-reload history, history
persisted to storage, a history popover or a list of steps to jump to, undo of the
camera or of selection (neither is in the Y.Doc at all), undo of cursors/presence
(story 6, not in the objects map), and undo of comments (story 16, which is what
`addScope` is waiting for).

# Notes — Story 10: Draw shapes and connect them with arrows that follow when moved

Story 10 is complete: `npm run typecheck`, `npm run test:unit` (260), `npm run
test:component` (199), `npm run test:integration` (65) and `npm run test:e2e` (90,
Chromium and WebKit) pass, and the two new collaboration scenarios pass under the
nightly config (`npm run test:e2e:nightly`, 30; the one flake is the pre-existing
outage spec, which passed on its retry). The story itself is 35 unit, 30 component
and 12 end-to-end tests.

## Decisions & deviations

1. **An arrow stores the objects it joins, never their positions.** `from`/`to` are
   `{kind:'attached', objectId, fallback}` or `{kind:'free', x, y}`, and the points
   that get drawn are resolved from the live rectangles on every render
   (`resolveEndpoints`). That is the whole "follows when moved" requirement, and it
   costs nothing when a shape moves: no write, no update, no undo step, no sync —
   the arrow was never a place. `TC-25` measures exactly this: the ends stay
   `attached` across a drag of the shape, while the drawn line moves to the shape's
   new side.

2. **`fallback` is not a stale position, it is the anchor the end was last resolved
   to** — written by `detachConnectorsTo` at delete time and used only when the
   object it names is gone. Without it a detached end would have to be drawn at the
   object's centre, which is inside where the shape used to be and reads as a mistake.

3. **Detaching happens inside the same transaction as the delete.**
   `deleteObjects` calls `detachConnectorsTo(doc, targets)` before `objects.delete(id)`
   in its one `doc.transact`, so a delete of three shapes with four arrows on them is
   one update event and one undo step. `TC-14`/`TC-29` assert both halves.

4. **A connector's `x/y/width/height` are derived, not authored.** `objectsSnapshot`
   runs `deriveConnectorBoxes()` over the snapshot after sorting: it resolves every
   arrow's ends (up to four passes, so an arrow whose end sits on a shape that is
   itself an arrow's reference settles), and writes the bounding box of the two
   resolved points into the snapshot. This is what lets story 7's marquee, selection
   overlay and nudge work on arrows with no arrow-specific code in any of them. A
   perfectly horizontal arrow has zero height, which `isSize()` rejects, so
   `CONNECTOR_EMPTY_AXIS_FLOOR = 1e-6` floors the empty axis rather than the box.

5. **`HitTestContext` is the third argument of `hitTest`, and only arrows use it.**
   `{zoom, rects}`: an arrow cannot decide "did that click hit me?" without knowing
   the zoom (its tolerance is 6 px of *screen*) or where the objects its ends name
   currently are. Sticky notes and text ignore the argument entirely.

6. **`useActiveTool` owns tool state; `useBoardKeys` keeps owning the keyboard.** The
   design had the hook bind S/L/V/Escape itself. It does not: the board has one
   `window` keydown listener and one set of typing/read-only guards in
   `useBoardKeys`, and a second listener would need its own copies of both. The hook
   exports `TOOL_SHORTCUTS` and `isAvailableTool` and the key handler consults them,
   so adding a tool means adding one table entry — which is what the design wanted —
   without a second listener. Escape is now generic: any tool that is not Select is
   given up, so the four tools that exist today close on one key without a list.

7. **The hook takes `{canEdit, onSelect}`, where the design's hook took nothing.**
   `canEdit` is story 4's read-only gate: on a board that cannot be mutated the
   creation tools are not offered and the shortcuts do nothing, and the hook is not
   the place to silently allow it. `onSelect` exists because creating an object
   selects it, and the object does not exist yet at the moment the tool decides to
   select it: `BoardApp` holds the id as `pendingSelect` and selects it on the render
   where it appears. (This is why `TC-25`'s "the arrow is selected" assertion is a
   retried one: the selection lands on the render after the one that created it, which
   a real browser shows and a synchronous jsdom read does not.)

8. **Tools are given `doc` as a prop.** There is no document context in this app —
   every object component already receives `doc` the same way — so `ShapeTool` and
   `ConnectorTool` take it rather than inventing a provider for two components.

9. **`setShapeStyle(doc, id, {fill, stroke})` has an optional fourth `by` argument.**
   The design's signature has none; `NoteToolbar`'s existing calls to the sticky-note
   equivalent pass a `by`, and one test does too. Optional keeps the contract the
   design wrote and the callers working.

10. **A label is an HTML element beside the SVG, not a `<foreignObject>`.** Story 9
    learned this with text: `foreignObject` children have their own layout viewport,
    so a `position: fixed` textarea escapes to the page and Safari's focus model
    disagrees with everyone else's. The label reuses `fitFontSize` and the measurer
    from `StickyText.ts`, so a shape's words fit the same way a note's do, and
    `SHAPE_LABEL_INSET_WORLD` is the same inset in world units.

11. **The arrowhead is an explicit `<polygon>`, not an SVG `<marker>`.** A marker's
    `markerUnits`/`orient` interaction with `vector-effect: non-scaling-stroke` is
    browser-specific, and a polygon's points come out of the same resolved geometry
    the line is drawn from, so an arrowhead is always the size and angle the arrow
    actually has.

12. **Two browser behaviours the e2e scenarios found, and neither jsdom could have.**
    Both are recorded here because they were expensive to find and will not be:

    * **`vector-effect: non-scaling-stroke` is not honoured for hit-testing.** The
      invisible click line under the arrow was stroked at 12 units with that effect,
      which draws 12 px wide at every zoom — and at 200% was clickable 12 px either
      side of the line while the model's tolerance was 6 px. Measured in Chromium by
      clicking outwards from the line at 50/100/200/400%: the band was 3/6/12/24 px
      wide, exactly `6 × zoom`, not 6 px. (WebKit's numbers were not taken; it passes
      the scenario written against the rule the model uses.) The click line
      is now stroked at `CONNECTOR_HIT_TOLERANCE_PX * 2 / zoom`, so the pixels and the
      hit test agree at every zoom; `TC-20` asserts the product, and the e2e scenario
      asserts the behaviour with real clicks.
    * **An element inside a `pointer-events: none` container receives nothing.** An
      arrow's box must take no clicks — an arrow laid across a shape must not steal
      that shape's clicks — so the container refuses them, and the end handles inherit
      that refusal. A real pointer fell through the handle onto the line underneath:
      `data-dragging` never went true and the end never moved. The handles now ask for
      `pointerEvents: 'auto'`. jsdom fires an event straight at the element you hand
      it, whatever its computed `pointer-events` says, so this class of bug is
      invisible below the browser layer.

13. **`createConnector` returns `null`, and refuses in the model as well as the
    tool.** Same object at both ends, a self-connection, an end that names nothing,
    and an arrow shorter than `CONNECTOR_MIN_LENGTH_WORLD` are all refused. The tool
    has the same self-release guard, because a drag that starts and ends on one shape
    should not even try. A drop onto the object the *other* end holds is refused by
    `setConnectorEndpoint`, and the component writes nothing at all in that case: the
    line is resolved from the model every render, so an unwritten end is already back
    where it started, which is the snap-back the design asks for and one less write.

14. **`SHAPE_FILL_COLORS.none` is the string `'transparent'`, and 'none' is an
    ordinary palette member** — a shape with no fill is a shape. The outline palette
    has no 'none' entry (the design's), so `isStrokeColor('none')` is false and the
    swatch row has six entries, not seven. The 'none' swatch is drawn with a red
    diagonal, and its `<line>` carries a `-slash` test id, which is why the e2e counts
    `button[data-testid^="shape-fill-"]` rather than any element with that prefix.

15. **Two existing unit tests used `'shape'` as an example of an unknown type.**
    Story 10 made it a known one; they now use `'widget'`. Nothing else in them
    changed.

16. **The board's geometry is part of the scenario, and arrows made it stricter.**
    An arrow's ends are placed by *clicking*, so every fixture point has to be on the
    page at the camera the page opens with: `world(x, y)` is `screen(x + 640, y + 400)`
    there, which puts anything at world y ≥ 400 below the page and anything at world
    x ≥ 640 into the zoom controls. The e2e files say where each shape is and why. The
    nightly delete-race scenario holds a pointer down across a 400 ms wait, which is
    why `connectors.spec.ts` runs in the ordinary config and
    `connector-collaboration.spec.ts` is matched by the nightly one.

17. **Where two shapes look at each other along a diagonal, the tie goes to the
    horizontal.** `nearestSide` calls a direction vertical when
    `|dy| × width > |dx| × height`; for two equal squares placed on an exact diagonal
    the two sides are equal and it falls through to left/right. The re-point scenario
    lands on that tie and asserts the consequence: after an end is re-pointed up and
    to the left, the *other* end has turned to leave the shape's left edge too.

## Not implemented (out of scope by instruction)

Multi-point or orthogonal arrows, elbow routing, arrowheads at both ends or none,
curved arrows, arrow colour/thickness/ dashed styles (arrows use the config's stroke
colour and width), a label on an arrow, shapes other than the three kinds (diamond,
star, image), rotation, snapping an end to a specific handle or side by hovering a
side, attaching an end to a *group*, resizing a shape from its handles while an arrow
is attached (the arrow follows the box either way), z-order controls for arrows, and
a connector that crosses another connector with a jump.

# Notes — Story 11: Sketch freehand with a pen

Story 11 is complete: `npm run build`, `npm run typecheck`, `npm run test:unit` (281),
`npm run test:component` (212), `npm run test:e2e` (98, Chromium and WebKit — 49 per
browser) and `npm run test:e2e:nightly` (34, both browsers, `--retries=0`) pass. The
story itself is 21 unit, 13 component and 6 end-to-end scenarios (4 in the ordinary
config, the two multi-context ones in the nightly one). The end-to-end ones run against
a real room with `--retries=0`, and none of them is skipped, timed out around or
`test.only`d.

## Decisions & deviations

1. **The box is decided before the path is written.** `createStroke` takes the points'
   bounding box padded by half the line's thickness — a thick line's ink reaches past the
   points it is made of, and a box that stopped at the points would clip the drawing —
   then stores the points as offsets from the box origin in a flat `[x0, y0, x1, y1, …]`
   rounded to two decimals, with `baseWidth`/`baseHeight` the box size at creation. A
   press that never moved (less than `DRAG_THRESHOLD_PX`, the same threshold dragging
   notes uses) becomes a dot whose box is exactly the thickness square, so it is
   selectable and movable like any other object.

2. **`scaledPoints` is the one function that says where a stroke is.** Draw
   (`StrokeObject`), hit (`registry.tsx`), and assert (TC-20's e2e) all call it: stored
   offsets turned back into world points at the object's current `x/y/width/height`. It
   is why resizing needs no stroke-specific code and why "the hit test follows the
   drawing it drew" is true rather than hoped: a resize writes only the box, and the
   drawing that comes out of `scaledPoints` has grown with it. It returns `[]` for a
   degenerate box (zero width or height, non-finite scale) rather than inventing points.

3. **Ramer-Douglas-Peucker, with a stack instead of recursion.** `simplify(points, tol)`
   keeps the first and last point and, between them, every point farther from the chord
   than the tolerance. Recursion is the textbook shape and the wrong one here: at
   `STROKE_MAX_POINTS` (5000) a wobbly line nests thousands of calls deep, in code that
   runs on the pointer-up of anyone's pen. Tolerance is
   `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, so the threshold is a fixed number of *screen*
   pixels — TC-04 pins that reasoning (input in world units, the world-space error at the
   chosen zoom must be within one screen pixel), and TC-05 is its converse: 2 px of world
   error at zoom 4 is 8 px on screen and must survive.

4. **`smoothPath` is the quadratic-midpoint curve**: move to the first point, one
   quadratic per interior point with the control point at that point and the endpoint at
   the midpoint toward the next, then a line to the last point. The curve passes through
   the midpoints, so the sketch's own wobble stays and the sampling's corners go. TC-07
   asserts the command sequence literally (`M`, n-2 × `Q`, `L`) and that every coordinate
   in it is finite, because a `NaN` in a `d` string is an object that draws nothing and
   blames the browser.

5. **Nothing is copied per pointer move, and nothing is copied per frame either.** The
   recording lives in a ref; the preview updates at most once per animation frame — the
   pointer handler marks it dirty and asks for a frame, and the frame writes one `d`
   string into one path element (`pen-preview-path`) with no React state in the loop. A
   240 Hz mouse therefore does not mean 240 renders. `getCoalescedEvents()` is read where
   the browser offers it, so a fast stroke's intermediate positions are recorded without
   being drawn. TC-09 counts `d` writes during a burst of 30 moves against the frames
   that elapsed; TC-10's "a stroke is committed once, not per move" is the same claim from
   the other side, made by counting undo steps.

6. **Everything that can end a drag ends it the same way.** `pointerup` (primary only),
   `pointercancel` — the board's own pinch, a system gesture, a stylus erasing — and
   `lostpointercapture` all go through one `finish()`: commit, clear, release. TC-14 fires
   all three and asserts the same result each time: one stroke, nothing left on screen,
   pen still selected. A drawing that disappears because the operating system took the
   pointer is the worst failure available in this story, and the handler is the reason it
   does not happen.

7. **The pen is not given up after a stroke.** `onCreated` is deliberately not called, so
   the next line starts with the next press instead of with a click on the toolbar; Escape
   or `v` hands the board back, and `useBoardKeys`'s precedence already puts the active
   tool's own Escape handler first. TC-10 asserts that, and asserts the tool buttons are
   still `aria-pressed` while a drawing is selected — the other half of "you are still in
   the pen".

8. **A stroke longer than `STROKE_MAX_POINTS` is continued, not truncated.** On the move
   that fills the last slot the recording is committed as it stands and a new one starts at
   the point that ended it, so the two strokes join, a line is never quietly shortened and
   a long scribble never refuses to finish. TC-13 tests the exact boundary (the limit, the
   limit plus one, the limit plus forty) and asserts the join off the objects themselves —
   the last world point of one against the first of the other.

9. **Colour and weight belong to the pen, not to the board.** `usePenOptions` is session
   `useState` in `BoardApp`, handed to the tool (to draw with) and `PenToolbar` (to show).
   It is not in the doc, not in the camera, not persisted: reload and the pen is back to
   black and medium, while every stroke already down keeps the colour it was drawn with,
   because `color` and `thickness` are fields of the object. TC-16 is that pair. It is the
   same call the shape tool makes, and it is a decision rather than an oversight — the
   design's "kept for the session, not per board" is the sentence it answers.

10. **The hit test is the polyline's, and what answers the pointer is the line, not the
    box.** The registry entry calls story 10's `distanceToPolyline` with `scaledPoints`
    and a threshold of `max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom)` — the
    connector's shape, in the connector's units (a screen-pixel tolerance divided by zoom,
    so it stays a screen-pixel tolerance at any zoom). The empty inside a loop belongs to
    nobody: TC-15 asserts the miss inside a 240×200 box whose line is 100 away, the hit at
    5 px, the miss at 7 px, at zoom 0.5 and 2. In the DOM that is a second invisible path
    at twice the tolerance with `pointer-events: stroke`; the visible path and the
    container are `pointer-events: none`. Marquee selection stays a box test, as it is for
    every other type — that is the board's "rub everything in the way" idiom, not a claim
    about ink.

11. **Malformed points make a stroke invisible, never half-drawn.** `readObject`'s stroke
    branch returns `null` for a non-array, an odd-length array, a non-finite coordinate, a
    `baseWidth`/`baseHeight` that is not a positive number, an unknown colour or an unknown
    weight — the connector's and shape's pattern, which is what keeps one bad object from
    taking the board down (story 9's lesson). `points: []` renders no path.

12. **One stroke is one transaction, and a drag is silent.** `createStroke` opens the
    `LOCAL_ORIGIN` transaction and closes it when it returns; during the drag nothing is
    written, so a collaborator never receives a half-finished line and the whole stroke
    undoes as one step. TC-18 holds the pen on one screen and polls the other through the
    whole 1500 ms of a drag (zero strokes, no latency sample), then requires the stroke on
    the other screen within `LIVE_UPDATE_LATENCY_BUDGET_MS` of the release. TC-20 drives
    select-by-the-line, proportional resize, move and delete from the screen that did not
    draw, checking each step on both.

13. **`ObjectSnapshot.color` had to become `StickyColor | PenColor`,** because the stroke's
    colour and the note's colour are different enumerations that share four names. Every
    type guard is a list membership test against the config's own list (`isPenColor`,
    `isPenThickness`), never a bare `string` — which is what makes the union cheap: a typo
    in a colour is invisible on the board rather than a crash, and the guard is the place
    that decides.

14. **The undo step is closed with `boundary()`, not `stopCapturing()`.** `useUndo` exposes
    `boundary()`; `stopCapturing` is the controller's own private method. TC-10 and TC-12
    count `undo.getUndoStackSize()` across boundaries, which is the only way to tell "one
    stroke is one step" apart from "one transaction happens to be one step".

15. **`localIdentityId()` for `createdBy`,** as stories 7 and 10 do — which is what makes
    the pen's strokes undoable by the person who drew them and invisible to nobody.

## Things a later maintainer will want to know about the browser tests

- **The pen surface is not findable from the outside until it exists.** The React app
  mounts at `document.getElementById('root')`; there is no `[data-testid="board-root"]`. So
  the e2e starts from a note's own element and walks up to the body looking for
  `[data-testid="pen-tool"]` among its descendants — and every scenario makes its first
  object with the board's own tools first, because with the pen unmounted there is no pen
  surface to talk to.
- **A real ctrl+wheel is Chromium's, not the page's.** Chromium takes ctrl+wheel as its own
  page zoom: the app's camera does not move, and `defaultPrevented` is what tells you the
  page got there first. That is why `tests/e2e/helpers/board.ts` has `dispatchCtrlWheel`,
  and the pen test takes the same route — it dispatches a `WheelEvent` with `ctrlKey` over
  *the pen surface*, which is the claim under test ("the pen does not hold the wheel"), and
  asserts both that the board's listener stopped it and that the camera zoomed. The
  unmodified wheel is left real (`page.mouse.wheel(0, 200)`), and the pan it owes is
  `cam.y + 200 / zoom`, because the board pans with `panBy(cam, -deltaX, -deltaY)`.
- **A double-click with the pen open is two dots.** Two press-release pairs, and a press
  that never moved is a stroke: two strokes on the board, no note. The test says so, and it
  is also why the double-click that must make a note (after the pen is given back) happens
  in clear space — the two dots are objects now, and a hit band would take the click.
- **Five thousand moves from the driver are not practical.** Every `page.mouse.move` is an
  IPC round trip of milliseconds, so a 5000-point drag would spend tens of seconds driving
  before asserting anything; the long recording is handed to the pen surface as
  `PointerEvent`s in one `page.evaluate`. Two consequences worth knowing:
  `setPointerCapture` throws for a synthetic pointer id (the pen catches it and carries on,
  which is its own small robustness claim), and `getCoalescedEvents()` returns nothing for
  synthetic events, so the pen records one point per event — the harder case for the limit,
  which is the thing being tested.
- **How often a drag redraws the preview is the browser's business.** In headless WebKit
  120 driver moves produced four distinct preview paths; in headless Chromium, more. So the
  end-to-end test asserts the frame-rate-independent half of "it follows the hand": the
  preview exists while the pointer is down, changes at least three times, and its last path
  is longer than its first — a line drawn once at the end cannot grow. The strict per-frame
  bound is unit-tested instead (TC-09), where frames are counted rather than hoped for.
- **A "nothing arrived" claim needs the room proved first.** TC-18 draws a warm-up stroke
  and waits to see it on the other screen *before* measuring the silence during the next
  drag. A room that was never shared shows the same beautiful emptiness.
- **The board's geometry still applies.** Fixtures are placed on the page, not in the
  world: the point of a drag is `screen → world` through `window.__vidi6.getCamera()`, the
  zoom controls live at screen x ≥ 1015, y ≥ 650 so no scenario drags through them, and the
  resize of a sketch that has been panned far off-screen would fail on the *handle* being
  unreachable rather than on anything about strokes — so the resize scenario draws at the
  origin.

## Not implemented (out of scope by instruction)

Pressure and tilt (a stroke has one thickness, chosen before the drag), erasing part of a
stroke or erasing with the pen, a pen that draws on the board's grid or snaps to it,
freehand shape recognition (a drawn circle stays a drawn circle), straight-line and
shape-constrained drawing, more than one pen (highlighter, marker, pencil) or more than six
colours and three weights, stroke edit tools — moving or deleting individual points,
re-smoothing, changing a finished stroke's colour or weight (a stroke keeps what it was
drawn with), rotation of a stroke, stroke z-order controls beyond what the board does for
everything, persisting the pen's colour and weight per board or per person, a cursor that
changes shape or size with the pen's settings, and a stroke that a second person can draw
onto the same object.
