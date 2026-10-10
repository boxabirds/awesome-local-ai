# Notes: decisions and deviations

## Tooling / versions

- `@playwright/test` is pinned to `~1.63.0` because the browsers available on this
  machine (chromium-1243, firefox-1543, webkit-2359 under `$PLAYWRIGHT_BROWSERS_PATH`)
  are exactly the revisions Playwright 1.63.0 expects. Newer Playwright releases
  would require downloading new browser builds.
- `typescript` is pinned to `~5.9.3` (the `latest` tag is the 7.x native compiler,
  which is newer than the rest of the toolchain assumes).
- Everything else is current: Vite 8 + `@vitejs/plugin-react` 6, Vitest (projects),
  React 19, Wrangler 4.
- Story 3: `vitest` is pinned to `^4.1.11` (was `^5.0.3`) because
  `@cloudflare/vitest-pool-workers@0.23` peer-requires `vitest ^4.1.0`. The
  multi-project config keeps its shape; unit/component behaviour is unchanged
  (75 unit tests pass on 4.x).
- Story 3: `@cloudflare/vitest-pool-workers` prints a rename warning on every run
  ("has been renamed to `@cloudflare/vitest-plugin`, will not receive future
  updates"). The design names the pool package, so that is what the project uses;
  migrating is a one-line plugin swap plus `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`
  if a later story wants it.
- Story 3: `wrangler.jsonc` `compatibility_date` is `2026-08-22`, not the
  `2026-09-01` stories 1-2 used. The workerd build bundled by the pool's
  miniflare refuses anything newer ("newest date supported by this server binary
  is 2026-08-22"), and one config has to satisfy both `wrangler dev` and
  `vitest --project integration`.
- Ports: every server this story starts listens inside
  `$AGENT_PORT_FIRST..$AGENT_PORT_LAST` (28400-28415). `wrangler dev` uses
  28400 with `--inspector-port 28401`; `vite dev` uses 28402 (`DEV_PORT` overrides),
  so `vite dev` and `wrangler dev` can run at the same time. The integration
  pool needs no port: `vitest --project integration` listens on no TCP socket at
  all (verified with `lsof` during a run — workerd talks to the pool over
  pipes), so it cannot collide with the range.

## Design interpretation

- `useCamera(viewport)` is owned by a `CameraProvider` (context) rather than by
  `BoardViewport`, because the design wires `ZoomControls` and `NavigationHint`
  "in `App.tsx` to `useCamera`" while `BoardViewport`'s contract takes only
  `children`. `CameraProvider` renders the full-window board area, measures it
  with the `ResizeObserver`, calls `useCamera`, and exposes the camera and the
  input handlers through context; `App.tsx` stays the wiring point (it renders
  `BoardViewport`, the `ZoomControls` bridge and the `NavigationHint` bridge
  inside the provider). The extra file is
  `src/client/canvas/CameraProvider.tsx`.
- Initial camera equals the reset view (`resetCamera(viewport)`) applied once the
  viewport has been measured, so "Reset view" is a no-op on a freshly opened
  board. The apply path for that initial sync does **not** trip the
  `hasNavigated` latch, so the first-use hint is still visible (PRD `nav.hint`).
- `hasNavigated` is a ref-backed latch mirrored into state (a ref alone would not
  re-render the hint).
- The dot grid is a separate absolutely positioned element carrying the CSS
  background, so e2e can read `background-size`/`background-position`; both it
  and the viewport are valid pan surfaces (`data-pan-surface`), while the world
  layer is `pointer-events: none` so drags always start on empty board space.
- Pixel-level e2e assertions measure the origin crosshair marker
  (`data-testid="origin-marker"`) via `getBoundingClientRect`, which is exact and
  not affected by clipping. Grid geometry is asserted through computed
  `background-size`/`background-position`. In test builds only, a second
  crosshair (`data-testid="test-marker-far"`) sits at
  `(UNBOUNDED_PAN_TESTED_EXTENT, UNBOUNDED_PAN_TESTED_EXTENT)` so TC-27 can
  measure real pixels 1,000,000 units away.
- `src/client/canvas/testHooks.ts` installs `window.__vidi6` only when
  `import.meta.env.MODE === 'test'` (i.e. `npm run build:test`), so production
  builds drop it. `setCamera` is programmatic and does not trip `hasNavigated`;
  `getCamera` is exposed to make e2e assertions easy.
  Verified: the production bundle contains neither `__vidi6` nor `test-marker-far`.
- `ZoomControls` stops wheel **propagation** but deliberately does **not**
  `preventDefault` (design `viewport.input`, TC-30: "browser default not
  suppressed there"). I briefly added `preventDefault` so a Ctrl-wheel over the
  chrome can never zoom the page, then reverted it: the PRD promise
  (`zoom.no_page_zoom`) is scoped to gestures _over the board_, and TC-30 asks
  for the opposite assertion.

## Component tests (jsdom)

- jsdom 30 ships real `PointerEvent`/`WheelEvent` constructors, so the tests
  dispatch ordinary events (`fireEvent.pointerDown`, `createEvent.wheel`) and can
  read `defaultPrevented`. Only `ResizeObserver` and the pointer-capture methods
  need shims (`tests/component/helpers/shims.ts`); `ResizeObserverStub.resize()`
  is available if a test wants to simulate a window resize.
- Task 6 suggests fake timers for `requestAnimationFrame`. Vitest 5's fake timers
  do not fake `requestAnimationFrame` unless configured to, so the tests await a
  real jsdom frame instead (`flushFrame()` in `tests/component/helpers/board.tsx`,
  inside `act`) — same effect, no timer-configuration coupling.
- The tests read the camera back out of the rendered world-layer transform, and
  compare against values computed with `camera.math` (`panBy`, `zoomAt`,
  `resetCamera`) rather than against hand-written numbers. A mutation check
  (inverting the pan sign, zooming to the viewport centre instead of the pointer)
  makes two of them fail, so they are real checks.

## E2E

- `tests/e2e/helpers/board.ts` wraps the polling the browser needs: the DOM
  trails the camera state by one animation frame, so marker assertions
  (`expectMarkerAt`) poll; `expectCamera` polls the camera through
  `window.__vidi6.getCamera()`.
- Wheel deltas are engine-specific, so the tests install an in-page probe that
  records the `deltaX/deltaY/deltaMode` the page actually received and assert the
  camera moved by exactly that (non-circular, works in every engine).
- Playwright's `mouse.wheel` does deliver `ctrlKey: true` when `Control` is held
  (verified in Chromium). TC-24 skips with a message if an engine does not,
  rather than failing on an input it cannot synthesise.
- TC-25's "click + until it disables" loop races with the button disabling
  itself; `clickUntilDisabled()` tolerates the click that loses the race.
- Extra e2e beyond the listed TCs, because the PRD acceptance list is the real
  contract: wheel scroll pans the board, grid spacing follows the zoom, the zoom
  control is keyboard-reachable and operable with Enter/Space (a11y constraint),
  and resizing the window leaves content anchored to the top-left of the board.
- **Firefox and WebKit cannot start on this machine.** The revisions under
  `$PLAYWRIGHT_BROWSERS_PATH` (firefox-1543, webkit-2359) are exactly what
  Playwright 1.63 expects, and `firefox --version` works, but the builds Playwright
  launches abort immediately (`SIGABRT`; WebKit: `Abort trap: 6` from
  `pw_run.sh`), so every Firefox/WebKit test fails in `browserType.launch` before
  running. Chromium (1243) is unaffected. Instead of deleting the projects,
  `playwright.config.ts` probes browser availability
  (`scripts/probe-browsers.mjs`, cached under `node_modules/.cache`) and skips
  what cannot launch with a loud warning, so the suite stays meaningful and the
  three-engine intent is preserved. Run a fixed set explicitly with
  `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e` (no probe).

## Story 3: Worker + Durable Object setup

- `npm run typecheck` checks **two** TypeScript projects: `tsconfig.json` (the
  client/tests, DOM lib) and `tsconfig.worker.json`
  (`src/worker`, `src/shared`, `tests/integration`;
  `@cloudflare/workers-types` + `@cloudflare/vitest-pool-workers/types`, no DOM).
  `tsconfig.json` excludes `src/worker` and `tests/integration`. One project with
  both `lib: DOM` and the Workers types does not work: `WebSocket`, `Response`,
  `Blob` and friends disagree.
- Bindings are declared once, in `src/worker/env.d.ts`, as `Cloudflare.Env` —
  that is the type `import { env } from 'cloudflare:test'` has. `Env` in
  `src/worker/index.ts` is `interface Env extends Cloudflare.Env {}`, so the
  design's named export exists without duplicating the binding list.
- `npm run test:integration` builds first (`npm run build`): the pool serves the
  real `dist/client` through the `ASSETS` binding, so TC-05/TC-17 assert on the
  client that ships, not on a mock.
- `wrangler dev` was checked by hand at this commit: `/` 200, `/b/<id>` 200
  (`not_found_handling: single-page-application`; wrangler wants that spelling,
  not `single_page_application`), `/api/rooms/<bad!id>` 400,
  `/api/rooms/<id>` without `Upgrade` 426.

## Story 3: workerd websocket findings (measured, not assumed)

- `new WebSocketPair()` is a **global**; `cloudflare:sockets` exports only
  `connect` in `@cloudflare/workers-types` v5.
- The pair must be used as: put `pair[0]` (client half) on the
  `Response(null, { status: 101, webSocket })` and `accept()` `pair[1]`. The
  first version accepted `pair[1]` and returned it — every upgrade then failed
  with `TypeError: Can't return WebSocket in a Response after calling accept()`
  and the client saw close code 1006, which looks like a relay bug and is not.
- The payload of a **binary** websocket frame arrives as a `Blob`, on both sides
  (inside the Durable Object, and on `response.webSocket` of a `SELF.fetch`
  upgrade). It is not an `ArrayBuffer`, whatever the runtime types say. Reading
  it is async (`blob.arrayBuffer()`), which is why `BoardRoom` funnels each
  socket's frames through a small serial queue instead of handling them
  directly in the listener.
- A test-side client socket is `response.webSocket` + `.accept()` after
  `SELF.fetch(url, { headers: { Upgrade: 'websocket' } })`.
- Awareness is relayed as **the original bytes of the frame** (type byte
  included). Its body is already varuint-length-prefixed inside the frame, so
  re-wrapping the decoded payload would add a second length prefix and corrupt
  it. `decodeMessage` therefore hands back a view _including_ the body's own
  prefix, and `BoardRoom#relay` copies the frame verbatim.
- `initDoc()` on the room's document runs before the first socket joins the set,
  so the schema-version transaction never becomes a stray broadcast frame.
- Echo suppression is doubled on purpose: the room applies a client's update
  with that socket as the Yjs transaction origin (so the room never sends an
  update back to its sender), and `WebsocketProvider` does the same on its side
  (origin = provider), so a client never applies its own update twice.
- Sockets are accepted **without** hibernation. The document lives in memory
  until story 4; hibernating would let the runtime evict the object (and the
  document) while its sockets stay open. An open accepted socket keeps the
  object alive, which is also why "close every socket ⇒ the room goes idle"
  needs no timer of its own in this story.

## Story 3: running `wrangler dev` here (two traps, both cost time)

- **Inspector port**: wrangler dev connects to its own runtime inspector on
  `127.0.0.1:9229`, which this machine refuses (`connect EPERM 127.0.0.1:9229`).
  The dev server still prints `Ready on http://127.0.0.1:<port>` and accepts TCP
  connections, but **every request hangs forever** — it looks like a Worker bug
  and is not. Pass an inspector port from the allowed range:
  `npx wrangler dev --ip 127.0.0.1 --port 28412 --inspector-port 28413`.
- **Assets are snapshotted at startup**, and the assets directory watcher is
  disabled here ("Assets directory watcher hit a platform limit"). After
  `npm run build`/`build:test` the running server still serves the _old_
  `index.html`, whose hashed asset no longer exists, and the SPA fallback answers
  `/assets/index-<old>.js` with HTML → "Failed to load module script: Expected a
  JavaScript-or-Wasm module script but the server responded with a MIME type of
  text/html" and a blank board. Restart the server after every build (Playwright's
  `webServer` does that for free, which is why the e2e task starts the server
  itself instead of reusing a hand-started one).

## Story 3: client connection notes (task 4)

- `y-websocket@3`'s provider sets `synced = false` on every close _before_ it
  emits `status: disconnected`, so the client-side state machine sees both
  events and does not have to infer a lost connection from `sync(false)` alone.
  `closeWebsocketConnection` only emits `disconnected` when the socket had been
  up, which is what makes "first load that never connected" stay `connecting`
  without extra bookkeeping (a board in front of a dead server never shows
  "Reconnecting…").
- `provider.destroy()` does **not** destroy the provider's `Awareness`, and
  `Awareness` owns a `setInterval` of its own — `connectBoard`'s `destroy()` does
  it, or every board tab leaks a timer past unmount.
- `disableBc: true` is not cosmetic: with the BroadcastChannel channel on, two
  tabs of one browser sync _around_ the server, and TC-22 would pass on a
  machine where the Worker is broken.
- The badge state machine (`createConnectionTracker`) is exported separately
  from `connectBoard` on purpose: the component tests drive the transitions
  directly. A real socket in jsdom cannot be driven deterministically, and the
  design asks for a fake provider here and the real one in the browser tests.
- `tests/component/helpers/shims.ts` now replaces `globalThis.WebSocket` with
  `FakeSocket`, which never opens. Rendering the whole board (which story 3 does
  for the camera tests) starts a connection, and jsdom would otherwise dial a
  server that is not there; staying in `CONNECTING` is also exactly the state a
  board in front of an unreachable server is in.
- `role="status"` is _not_ unique to the badge: story 1's zoom percent is an
  `<output>`, whose implicit ARIA role is `status`. `getByRole('status')` matches
  both, so the e2e tests select `data-testid="connection-status"` and use the
  accessible role only for what it proves (the badge announces itself).
- `window.__vidi6` is written by two effects (camera hooks, connection state), so
  `installTestHooks` merges instead of assigning, and `publishConnectionState`
  writes through the same object.
- Routing is deliberately not a dependency: `useBoardRoute` reads
  `/b/:boardId` from `window.location.pathname`, listens to `popstate`, and
  replaces a URL that is not a board (`/`, or an id that could not be one) with a
  fresh `/b/<newBoardId()>`. A malformed id is therefore never dialed as
  `/api/rooms/<id>` from this app; the server still answers 400 for it (TC-04).
  Story 5 replaces this redirect with server-side board creation.

## Story 3: integration tests in workerd (tasks 5 and 6)

`tests/integration/ws-client.ts` is a _test_ client that speaks the wire
protocol (y-websocket framing) against the real room, with `Y.Doc`s of its own;
`tests/integration/random-ops.ts` generates the design's edit mix from a seed.
Four findings that only showed up by running them:

- **workerd does not replay `open`.** On the client half of a `fetch()` upgrade
  the handshake is finished by the time `accept()` returns, so an `open` event
  can come and go before any listener exists — the client that waits for it never
  sends SyncStep1 and the sync exchange stalls one way. `BoardClient.join` calls
  its `#hello()` (idempotent: mark open, send SyncStep1) right after `accept()`,
  and keeps the listener in case a runtime does fire it.
- **y-protocols swallows a bad update.** `readSyncStep2`/`readUpdate` wrap
  `Y.applyUpdate` in `try/catch`, call an optional `errorHandler`, then
  `console.error('Caught error while handling a Yjs update', …)` and carry on.
  So "an invalid Yjs update payload costs its sender the connection" (TC-15)
  needs the room to pass an error handler that _rethrows_
  (`src/worker/board-room.ts`); without it the room logs and relays as if nothing
  happened. Unknown _frame_ types and unknown _sync_ types already throw out of
  `readSyncMessage` on their own.
- **`evictAllDurableObjects()` waits for the object to become idle**, and a room
  with a socket still open never does — one leaked socket anywhere in the file
  (which is what a failing test leaves behind) turns the restart test (TC-18)
  into a 30 s timeout. `abortAllDurableObjects()` is the honest tool for TC-18
  anyway: it is a restart, not a graceful eviction, and both take no namespace
  argument ("all" means all).
- `setStickyColor` rejects colour names outside the palette _silently_ (no
  transaction), so a test that asks for `'purple'` waits forever instead of
  failing loudly. `recolourNote` in the helper is typed
  `StickyColor`/`STICKY_COLOR_NAMES` for that reason. The palette is yellow,
  orange, green, blue, pink, violet — six, not four (the "four colours" wording
  in some spec prose predates story 1's palette; the model is the source).
- `synced()`/`closed()`/`waitFor()` in the helper time out after 3 s and the
  integration project's `testTimeout` is 60 s, so a stall reports _its own_
  message (including the frame counters) instead of vitest's generic "Test
  timed out". `console.log` does reach the reporter under
  `--reporter=verbose`, which is where the TC-12 seed and per-client op counts
  are printed.
- TC-04 asserts `listDurableObjectIds(env.BOARD_ROOM)` is empty — a bad id did
  not merely fail to answer, no room object was ever instantiated. It has to be
  the first test in `worker.test.ts`: objects live for the whole file.
- TC-13 is written as `MAX_CONCURRENT_EDITORS + 1` clients around one board and
  asserts the last one's note reaches all the others _and_ that they all hold the
  same position — nobody is turned away, and nobody is second-class.

## Story 4: storage (BoardStore) — measured behaviour that changed the design

- **`src/client-workers-storage.d.ts` exists because two tsconfigs disagree about
  the platform.** The client project (`tsconfig.json`) has DOM libs and no
  `@cloudflare/workers-types`; the worker project has the opposite, and
  `tests/fixtures/boards.ts` is compiled by both. The shim declares only the
  four storage types `board-store.ts` touches (`DurableObjectStorage`,
  `SqlStorage`, `SqlStorageCursor`, `SqlStorageValue`) so the store can be
  imported from a test in either project. It is a `.d.ts` with no runtime
  content, and the worker project never loads it (it has the real types).
- **SQL failure is injected by replacing `storage.sql`, not `storage`.**
  `state.storage` is the same object across `runInDurableObject` calls for one
  instance, so `broken-storage.ts` puts a `Proxy` in front of the real
  `SqlStorage` that throws for statements matching a pattern and forwards
  everything else. An object literal is not enough: `SqlStorage` also carries
  `databaseSize`, `Cursor` and `Statement`, and a partial fake loses
  `transactionSync`'s real rollback — which is the whole thing TC-07 tests. The
  proxy is removed again in the same DO hop, and each test names its own board
  so no two tests share an instance.
- **TC-05's negative case cannot fail, and the reason is worth keeping.** The
  design asks for "read the rows in the other order and the final position
  differs". It does not: `Y.applyUpdate` is a CRDT merge — idempotent and
  commutative — so a set of updates has one result whatever order they arrive
  in. Measured, logged and asserted as `sameEitherWay: true` rather than
  deleted: the order that matters is the _query's_ (`ORDER BY seq ASC`), because
  it is what makes a hole in the log visible instead of invisible.
- **A hole in the update log loses the whole tail, not one change** (this is the
  one that changed the code). Every update a board writes comes from one
  client's clock, so an update whose clock range is missing is kept by Yjs as
  not-yet-applicable — and so is every update after it. Measured on the
  25-note fixture: apply all rows but row 3 and the board comes back with 1
  note; apply row 3 afterwards and all 25 are there. Nothing throws, nothing is
  logged. So TC-09/TC-10 as written ("skip the bad row, the rest loads, 24
  notes present") describes a board silently missing 24 notes, which is the
  failure this story exists to prevent. `BoardStore.load` therefore:
  - stops at the first row it cannot apply,
  - copies that row (bytes, `seq`, error text, timestamp) into
    `quarantined_updates` with `INSERT OR REPLACE`, and **leaves it in the log**
    — deleting it would leave a hole whose loads then _succeed_ with the tail
    gone, once, which is worse than failing every time,
  - returns `{ok: false, reason: 'log-unreadable', error: 'seq=7: …',
quarantined: 1}`, which reaches the room as a load failure (close 4500) and
    the client's "this board could not be read" screen.
    Every retry ends the same way. A snapshot that cannot be read still quarantines
    nothing (TC-10's negative is unchanged: TC-11's `sql-error` and TC-10's
    "nothing deleted" both hold).
- **Compaction only runs on a log the store read whole.** `compactIfNeeded`
  deletes rows it has folded into the snapshot, so it is only ever called after a
  `load` that read every row it listed; the store keeps its own row/byte counters
  from that read rather than trusting a `COUNT(*)` that could disagree with what
  is in memory. A refused load leaves the counters alone and the room never
  compacts a board it failed to open.
- **Snapshot chunks are content-defined by byte offset** (`idx = 0,1,2…`,
  `SNAPSHOT_CHUNK_BYTES` each) so a 2000-note board stays under the Durable
  Object per-row limit (TC-08 measures ~1.0 MB over several chunks). The
  `snapshotThroughSeq` meta row is written in the same transaction as the last
  chunk: a compaction that dies part-way rolls back to the old snapshot plus the
  old log (TC-07), which is why the room can simply try again on the next change.

## Story 4: hibernating room — what workerd does differently (measured)

- **A client that hangs up no longer hears itself hang up.** With story 3's
  plain `server.accept()`, the room's socket closed when a client left and the
  close reached the client end, so `closed(client)` could wait for it. With
  `ctx.acceptWebSocket()` the runtime owns that end and keeps the close on the
  room's side: the leaving client's own `close` event never fires (measured, 4 s
  of waiting). A browser does not care — it fires `close` locally — but a test
  that treated "my close event arrived" as "the room knows I left" is now wrong,
  so `ws-client.ts` gained `roomSockets(boardId)` / `roomHolds(boardId, n)`,
  which ask the object how many sockets it has. That is also the only question
  that can be asked about a _hibernated_ socket, so it is the better instrument
  anyway. Story 3's TC-18 case ("a room that lost everything, refilled by the
  first client back") is rewritten as its story 4 meaning: the room comes back
  holding the board, and a client whose document is ahead of it merges instead of
  rescuing.
- **The room's socket list is the runtime's, and it is right**: after two joins
  `ctx.getWebSockets()` is 2, after one client left it is 1 (measured through
  `state.getWebSockets()`), and after the room closes them it is 0. Nothing to
  remove, nothing to leak — which is why `webSocketClose` in the room is a
  no-op and `#send` closes a socket whose `send()` throws instead of dropping it
  from a private set.
- **A hibernating object's handlers may be run against a reconstructed object**,
  so nothing about a socket may live in a closure. Story 3 kept a per-socket
  `pending` promise chain (because frame payloads arrive as `Blob`s and reading
  one is async); a hibernating object gets the payload as an `ArrayBuffer`, so
  the chain is gone and there is no per-socket state at all. Nothing needs
  `serializeAttachment`/`deserializeAttachment` either: everything the room needs
  about a socket is the socket.
- **`blockConcurrencyWhile(load)` in the constructor holds every event**, so the
  `fetch`/`webSocketMessage` handlers never see phase `loading` — the room's
  `#closeCode` still answers "we do not know this board yet" with 4500 rather
  than pretending, but no test can reach that branch.
- **`ctx.acceptWebSocket(server)` then an immediate `close(4500)` does reach the
  client** with that code (measured: `{code: 1000, reason: 'probe'}` for a
  room-side close), which is what the load-failure path depends on: accept, then
  refuse, so the browser's websocket exists long enough to see the code.
- **`BoardStore.compactionDue()`** (added for the room) exists so the room does
  not claim to be `compacting` on every keystroke: the threshold is the store's
  counters, and the phase is only entered when there is something to fold.

## Story 4: the persistent room, measured (TC-12 to TC-18, TC-26)
- **Every client's own schema is a row.** `initDoc` is not a room-only thing: a
  client's board is created by the same code, with the client's own `clientID`,
  so its `meta.schemaVersion` transaction is a real update by a real peer and the
  room stores it like any other socket change. A board nobody has drawn on
  therefore holds one ~39-byte row *per client that has synced*, and one row per
  change after that. Two clients, no drawing: 2 rows — and that count is the
  proof that the room does not log its own copy (`LOCAL_ORIGIN`), because a room
  that did would sit at 3. TC-25's "an undrawn board has nothing in it" is a
  statement about the store; at the room level the honest version is this one, so
  the room tests measure a baseline row count and assert *differences* (a change
  is +1, a failure is +0) rather than magic numbers.
- **A hibernating room survives being thrown away, and its clients do not notice.**
  `evictDurableObject(stub)` with two idle sockets: both ends stay `open`, the
  object is gone, and the next frame reconstructs it — constructor reads the
  board, then broadcasts to two sockets it never accepted. That is the only way
  to test the hibernation path for real, and the only thing it can test with: the
  room's socket list is `ctx.getWebSockets()`, so there is no per-room state left
  behind to get wrong. `abortAllDurableObjects()` is the other half (abrupt kill,
  sockets dropped, storage kept), which is what TC-13's restart is.
- **What an object logs is observable.** A Durable Object in the vitest workerd
  pool runs in the same isolate as the test, so replacing `console.error` around
  an await catches the room's own line — including the store's message inside it
  (`board could not be opened (<id>): simulated: the disk is gone`). That, not a
  mocked logger, is how TC-26 says "the room said what kind of failure this is".
- **"It did not read the board again" is countable.** `watchSql` wraps the
  object's `sql` and records statements without refusing anything: inside the
  retry interval a connection produced *zero* `SELECT`s; after the interval the
  same list contains the reads (`FROM updates`, snapshot chunks). `breakSql` grew
  a `limit` argument, which is what makes TC-14's write failure a one-off — the
  room reacts to it, and the client's retry after it is a normal write.
- **`storedBoard()` is the test's idea of "what the board is"**: a fresh
  `BoardStore` and a fresh `Y.Doc` over the room's own storage, read while the
  room is still serving. Every durability assertion in this file is against that,
  not against a restart — a restart is a *second* assertion, so a room that only
  looks persistent because nobody looked at storage gets caught.
- **The room's answer to a newcomer's SyncStep1 is counted as `step2`, not as an
  update.** A test that expects a joined client to have "received an update"
  describes a room that pushes; this room answers a question, and the client's own
  counters say so.

## Story 4: the browser, the killed server, and what drawing 2,000 notes costs (TC-19 to TC-21)
- **Only the e2e suite can kill the server, so it owns it.** `tests/e2e/helpers/wrangler-process.ts`
  starts `wrangler dev --persist-to <own temp dir>` per test and stops it — politely
  (`SIGTERM`, "a deploy that lets the request finish", TC-19/TC-21) or as `SIGKILL`
  ("the machine stopped", TC-20) — and waits until the port is really free.
  `wrangler dev` runs the worker in a *child*, so it is signalled as a process
  group (`process.kill(-pid)`); killing the parent alone leaves workerd holding
  28404 and the next test talking to a server it did not start. One worker,
  `grep: /@persistence/`, ports 28404/28405; the ordinary config's `grepInvert` is
  `/@nightly|@persistence/`. A failure prints the server's last 60 log lines —
  which is how the first of these tests got explained.
- **`openBoard` answers before the app has finished moving the camera.** The board
  reports `{x: 0, y: 0, zoom: 1}` from `getCamera()` while it works out its first
  view, and applies its own initial camera (`{-640, -400, 1}` on a 1280×800
  viewport) a beat *later* — overwriting any zoom a test set in between. Measured:
  a test that zooms to 35% and then draws ends up drawing at 100%, notes 200px
  apart exactly touching, and the second double-click landing on a note.
  `zoomOutTo` therefore re-applies the zoom until it survives 500ms of nothing
  happening.
- **A note's toolbar is 40 screen pixels above the note at every zoom**
  (`.note-toolbar-anchor` inverse-scales), so a note within ~50px of the top of
  the viewport has colour swatches Playwright refuses to click ("element is
  outside of the viewport"). At zoom 0.35 the drawing grid starts at y=140 for
  that reason, and every cell is 200px apart so a double-click never lands on a
  note that is already there.
- **You cannot stack notes by double-clicking the same point** — a double-click
  on a note edits it; only empty board accepts a new one. Notes are stacked by
  dragging one onto another (`dragNoteTo(id, centreOf(other))`), which is also
  how a person stacks them, and which is the only way to get a stacking order
  that the board has to survive.
- **`createSticky(doc, at)` is given the *centre*, and stores the top-left**
  (`at - STICKY_SIZE_WORLD / 2`). A seeder that passes top-left coordinates is
  exactly 100 board units off in both axes — which is what TC-21 caught as
  "every note came back, none of them where they were put", and why
  `SeedNote.x/y` are top-left (what the board stores and `data-x` reports) with
  the conversion inside `seedBoard`.
- **Seeding happens in the client, through the client's own board model**
  (`window.__vidi6Board.seed`, `src/client/testSeed.ts`): one transaction per
  note, so 2,000 notes are 2,000 real Yjs updates over a real socket into a real
  room, and the room compacts along the way. Pasting fixtures into storage would
  have skipped the part of the product the test is about. Because one client's
  own screen cannot prove the *room* has everything, TC-21 waits for a second
  client to see all 2,000 notes before it stops the server.
- **Local state size** (logged, per board, `wrangler dev --persist-to`): a 25-note
  board ≈ 4.0 MB, a 2,000-note board ≈ 11.5 MB — Durable Object SQLite plus WAL
  per board, so size is closer to a floor per board than a sum of notes.
- **Measured times.** TC-20: the note reached the other screen 81–101ms after
  typing, the process was SIGKILLed 602–604ms after that (the design allows 1s),
  and a client that arrived later had it. TC-21: 2,000 notes seeded in ~2.7s;
  after a restart, a client that had never seen the board had all 2,000 rendered
  ~4.9s after opening (~2.5ms per note, Chromium included), against
  `BOARD_LOAD_BUDGET_MS` = 3,000ms, which is the number this is *reported*
  against and not asserted — the measurement ends with 2,000 note elements in a
  DOM, which is a browser fact rather than the board's load. Board load itself is
  timed in the integration suite, where it can be.
- On this machine firefox and webkit cannot launch (the story 3 probe says so), so
  these three ran in Chromium; the config runs every browser the machine can
  start, so the same three files cover Firefox wherever it starts.

## Story 4: the client that is told (TC-22, TC-23, TC-28)
- **`connection-close` is the client's only source of the close code, and it comes first.**
  Read out of y-websocket's own `closeWebsocketConnection`: it emits
  `connection-close` `[event, provider]` — the CloseEvent, not the code — then
  `status: disconnected`, then `sync: false`. So the tracker sees 4500 before it
  sees the disconnection, and must keep `load_failed` when the disconnection
  arrives (measured: without that guard, a red badge lived for one event and was
  then replaced by amber "Reconnecting…" — which reads as "the wire is the
  problem", the opposite of the truth). The same guard covers every later flap.
- **4500 is outside y-websocket's no-retry window, so retrying is already free.**
  `defaultShouldReconnect = !(code >= 4400 && code < 4500)`: a room that closes
  with `CLOSE_BOARD_LOAD_FAILED` is retried with the usual backoff, and TC-24's
  "recovers without a reload" needs nothing new in the client beyond mapping the
  code and unlocking on the first `sync(true)`.
- **A close with no code is never a load failure.** `provider.ws.close()` (the
  test hook `drop()`, story 3) and a connection whose end the browser could not
  see arrive as `event === null` / 1006; they mean "this connection is over".
- **"Red" cannot be checked in jsdom** — no stylesheet is loaded there — so the
  test reads `src/client/styles.css` and judges red as *red-dominant by a factor
  of two*. A naive "the red channel is the biggest one" test would have called
  the existing amber badge (`#8a4b00`) red too, and TC-28's whole point is that
  those two badges are not the same message.
- **The `y-websocket` fake in `tests/component/LoadFailure.test.tsx` implements
  the part `connectBoard` touches** (`on`, `emit`, `destroy`, `ws.close`,
  `awareness.destroy`) plus three methods that say what the socket did. Because
  the fake is handed the *app's own* `Y.Doc`, TC-23's negative assertion is not a
  spy count but the document itself: after the failure, `doc` received zero
  updates while the double-click, the disabled button, Delete, a drag and Enter
  were all attempted. Two things the code needs to know: `vi.mock` factories run
  before the test file's imports (so shared state goes through `vi.hoisted`), and
  in the jsdom project `import.meta.url` is a served URL, not a file path — files
  are read from `process.cwd()`.
- **`canEdit` is one boolean in App**, and it needs one more effect than the
  obvious gates: a note that was already open for typing stays open when the
  board locks, so keystrokes continue into the document. The effect that closes
  it (`endEdit` when `!editable`) is what makes "the handlers are no-ops" true
  for typing rather than only for the shortcuts.

## Story 5: shares, links and the pages they land on
- **A board's log has to begin with the transaction that sets the board up.**
  Measured with a legacy fixture that registered its `update` listener after
  `initDoc`: the rows are in storage, `GET /api/boards/:id` answers 200, the room
  accepts the socket — and `snapshot()` answers nothing, so the screen is an
  empty board. `legacyUpdates` in `src/worker/test-hooks.ts` listens first and
  initialises second. Neither the existence check nor a row count can see this;
  only "read the log back into a document" can, which is why TC-08 now does that
  at storage level and TC-31 does it in a browser.
- **A room reads its own storage when it wakes, not when somebody writes to it.**
  Seeding a legacy board by reaching into `state.storage` from a test (a real
  capability, and what story 4's storage tests do) leaves the awake room's
  document as it was, and a client that connects then gets what the room was
  already holding — measured: 0 notes. Test hooks that change a board therefore
  go through the room (`testSeedLegacy` re-reads after writing).
- **Test hooks are compiled in everywhere and armed in exactly one place.** The
  integration pool loads production `wrangler.jsonc`, where `TEST_HOOKS` is
  absent, so `testSeedLegacy` and `/__test/…` refuse there by design; only the two
  `wrangler dev` invocations the browser suites spawn pass `--var TEST_HOOKS:1`.
  That is why the integration-level legacy case cannot use the hook route and
  writes its legacy board through `BoardStore` instead.
- **The seed hook reports what it wrote** (`{ notes, rows, created_at: false,
  texts }`). A browser test then compares the screen against the server's own
  words about its storage rather than against a second copy of the fixture kept
  in the test, which is the thing that was wrong when the fixture was broken.
- **Note order on screen is creation order with an id tie-break**
  (`BoardContents` sorts by `createdAt`, then id, and never by z — restacking
  mid-drag would drop pointer capture). Three notes written inside one millisecond
  therefore share a `createdAt` and come back in arbitrary order; measured, one
  run produced 2, 3, 1. Assertions about *which* notes are on a board compare
  sets. `tests/e2e/helpers/notes.ts:noteTexts` returns render order, so it is not
  an ordering oracle.
- **The manual-copy path needs focus as well as selection.** `HTMLSelectElement`
  style `.select()` on the share input marks the range but leaves the field
  unfocused in jsdom and in a real browser, so the follow-up Ctrl+C would copy
  nothing; `focus()` then `select()` makes `document.activeElement` the field and
  the assertion in TC-29 (focused, `selectionStart === 0`, `selectionEnd ===
  value.length`) means what it says.
- **`dist/client` is one directory shared by two builds, and the difference is
  invisible until a browser suite fails.** `npm run build` (what ships) leaves no
  test hooks in the client; `npm run build:test` (what `npm run test:e2e*` does
  first) adds them, including the thing `connectionState()` reads. Run a plain
  `npm run build` and then a browser suite directly with `npx playwright test -c
  playwright.persistence.config.ts` and every participant dies with "never
  finished connecting to the room / nothing published" — while the server log
  shows the websocket upgrading happily (101). The tell is the asset hash in the
  wrangler log (`index-BPkJLJRU.js` instead of `index-CN2cIz0Y.js`). Use the npm
  scripts, or run `npm run build:test` by hand before `npx playwright`.
- **One intermittent failure remains in story 3's suite** and was *not* fixed
  here: `tests/e2e/live-collaboration.spec.ts` failed once in about ten full
  chromium runs on a `toHaveAttribute` assertion (`data-color` after a recolour,
  or `data-selected`), at ~5% under full-suite load. Five isolated runs of that
  file passed every time. Nothing in story 5 touches selection or colour; the
  board page now makes one extra HTTP request before it connects, so it is not
  impossible that a slower start nudges a tight window — recorded rather than
  papered over, because the fix belongs to the assertion that was written.
- **A note's stored coordinates are not screen pixels, and the gap is the view.**
  `tests/e2e/nightly-stability.spec.ts` (story 3's TC-30 soak) asserted that a
  note ends at the *screen* point its drag was aimed at. That is only true while
  the camera is at `{x:0,y:0}`, and the camera is not there for long: the app's
  own initial camera lands a beat after the board mounts (the same late landing
  `zoomOutTo` waits for), putting the world origin at the centre of the viewport.
  Measured, the soak's notes then render 640 px right and 400 px down from where
  their stored coordinates say they are, every screen agrees with every other
  screen, and the test reports every note misplaced by exactly that offset — a
  bug in the assertion, not on the board. **This failure is older than story 5**:
  it reproduces at story 4's commit `e020371` with the same numbers. The soak now
  builds its expectation from measured values — the note's own coordinates before
  the drag plus the pointer's travel divided by the zoom it travelled at — which
  is the sentence the test meant: *the note stands where the drag put it*, in the
  board's coordinates, whatever the view is doing.
- **Two things called TC-30.** Story 3's `@nightly` soak (above, passes) and
  story 5's "the Durable Object resets while a board is idle", which is not
  automatable here (see PROGRESS.md). `grep -n "TC-30" tests/e2e/` says which is
  which before anybody spends an afternoon on it.

## Story 7: gesturing at several objects at once (TC-32 to TC-36)
- **Wait for the view before turning a box into a mouse point.** Story 5's note
  above about "the gap is the view" bit these tests too, in a worse way: a board
  whose initial camera has not landed yet renders a note at board `-420` at screen
  `-420`, so a Shift+drag aimed at it moves the mouse to a negative point, presses
  nothing, and the test reports "nothing was selected" (measured: 1 run in ~10 on
  a loaded machine). `expectInitialView` (`tests/e2e/helpers/board.ts`) is the
  wait — it asserts the camera the board opens with, which is an assertion these
  tests were making implicitly and never checking.
- **A marquee helper says so when the board did not start one.** `marquee`
  (`tests/e2e/helpers/selection.ts`) waits for `marquee-rect` halfway through the
  drag. Before that, every failure of a rectangle came out as "selection never
  became …", which sent the debugging to the selection instead of to the press.
- **A press belongs to whatever is under it, including the page.** In a 1280x800
  window the share button sits at ~(16..46, 30..70) and the board toolbar at
  ~(16..48, 382..424). Above a cluster of notes, that is exactly where a
  top-left-to-bottom-right marquee would start, so these marquee drags all start
  at the bottom-left and go up: the rectangle is the same either way, and the
  press lands on the board.
- **Reads of the selection are polled, never read once.** A single
  `selectionOf(page)` after `mouse.up` loses the race with React's re-render
  (~5% of runs on chromium, more under full-suite load). `expectSelected` polls.
- **A resize expectation takes the axis that was pulled further.** Sticky notes
  are aspect-locked, so a corner pull of (150, 150) on a non-square box scales by
  `max(|scaleX-1|, |scaleY-1|)` — geometry's aspect lock, TC-04/TC-05. Writing the
  expectation as `scaleX` is a test that fails on a correct board.

## Story 8: a history of one's own (TC-01 to TC-24)
- **`boundary()` is not yjs's name for it.** This build (yjs 13.6.33) has no
  `UndoManager#boundary`; the method is `stopCapturing()`, which sets
  `lastChange = 0` so the *next* tracked transaction opens a new stack item. The
  controller keeps the design's name (`boundary`) and calls that. It also means a
  boundary is worth calling *after* a command as much as before it: yjs fuses a
  transaction onto the item above when it lands within `captureTimeout` of the
  last one, so a command that brackets itself is the only way to be sure neither
  neighbour joins it.
- **A batch written with a `null` origin was invisible to the history, and story 8
  found it.** `recolourSelection` (story 7) wrapped its ids in
  `document.transact(() => setStickyColor(...))`. `setStickyColor` does pass
  `LOCAL_ORIGIN`, but a nested `doc.transact` cannot re-origin a transaction that
  is already open — the outer origin wins, and it was `null`. A recolour therefore
  could not be undone, which is exactly what TC-15 asks for; the batch now opens
  with `LOCAL_ORIGIN`. Anything that batches model calls in the client should name
  its origin on the *outer* transaction, or the change belongs to no one.
- **Origin filtering is one `Set` per controller, and it must be fresh.** yjs adds
  the manager itself to the `trackedOrigins` set it is handed, so a module-level
  constant would let one board's history swallow another's transactions — two
  boards in one test file and one of them starts undoing the other's typing.
  `createUndo` builds `new Set([LOCAL_ORIGIN])` per controller (`undo.only_own`
  rests on that set being the only origin a local tab uses, which stories 2 and 3
  established and `tests/unit/helpers/peer.ts` now measures).
- **Undo cascades when an inverse has nothing left to act on.** When the top stack
  item's inverse changes nothing — the object it moved was deleted by somebody
  else — yjs's `popStackItem` walks down and applies the next own item. That is
  accepted here, not fought: TC-07 and TC-23 both end "no error, and nothing of
  anybody else's moved". A single-step guarantee would need a stack item per
  gesture frame or an origin-marker yjs does not have.
- **A fake clock has to exist before yjs is imported.** `lib0/time` binds
  `getUnixTime = Date.now` at module load, so `vi.setSystemTime` cannot move the
  clock yjs stamps transactions with — TC-12/TC-13 install fake timers, call
  `vi.resetModules()`, and only then `await import('yjs')`. One fake clock for the
  whole file: `vi.useRealTimers()` between tests leaves the previous generation's
  stopped clock in yjs, and every capture window then reads as eternity.
- **`addScope` is generic, not `AbstractType<unknown>`.** `Y.Map<string>` is not
  assignable to `Y.AbstractType<unknown>` — `EventHandler<T, …>` is invariant in
  `T` — so the controller declares `addScope<T>(type: Y.AbstractType<T>)`. The
  watched history in `tests/component/UndoControls.test.tsx` declares it as a
  method for the same reason: an arrow function would pin `T`.
- **The controller lives in `BoardContents`, not in `App`.** The design draws it
  beside the app shell, but `App` holds no document — `useBoardDoc` owns the
  `Y.Doc` inside `BoardContents`, and a history is a document's shadow. `App`
  renders `<BoardPage key={route.boardId}>`, so a link to another board replaces
  the component, its document and its history together (`undo.session_only`),
  which is the behaviour the design asked App to provide.
- **`useUndoController` falls back to a history that remembers nothing.** With
  neither an injected nor an owned controller it returns `NO_HISTORY` instead of
  asserting non-null or casting. Unreachable while a document is here; a board
  nobody can undo is the safe thing to be wrong about.
- **`aria-disabled` travels with `disabled`.** TC-18 asks for both, and it is the
  only way a screen reader hears *why* the button is inert rather than hearing
  that it is missing. The tooltips carry the shortcuts, which is the PRD's
  accessibility route for the same reason.
- **`load_failed` in a component test needs the socket seam.** TC-20's board must
  be locked by the room, not told it is, so `UndoControls.test.tsx` mocks
  `y-websocket` — the minimum `connectBoard` touches, enough to receive a 4500.
  `LoadFailure.test.tsx` keeps the full fake (backoff, close-without-code); if a
  third file wants it, that is the moment to lift it into `tests/component/helpers/`.
- **The e2e specs seed through the client, and seeding must not be undoable.**
  `__vidi6Board.seed` (`src/client/testSeed.ts`) writes in a transaction with no
  origin, which is why the eight notes of TC-22 are not in Mia's history when she
  arrives at them. A seeder that used `LOCAL_ORIGIN` would hand her eight steps
  she never did and a TC-22 that proves nothing.
