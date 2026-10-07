# NOTES

Environment notes and deviations from the story's test strategy on this machine.

## Ports

Every server listens inside `$AGENT_PORT_FIRST`..`$AGENT_PORT_LAST` (24208–24223 here).

| Port | Use |
|---|---|
| 24208 (`AGENT_PORT_FIRST`) | `npm run dev` (Vite dev server) |
| 24212 (`AGENT_PORT_FIRST + 4`) | e2e server: `wrangler dev` statically serving `dist/client` (test build) |
| 24213 | the `wrangler dev` inspector port that goes with 24212 |
| 24214-24215 | story 4's persistence specs (TC-19 to TC-21): a `wrangler dev` of their own per test, restarted in the test |
| 24216-24217 | held here by a `wrangler dev` this sandbox cannot signal, like 24210/24211 used to be; specs move past it and say so |
| 24218-24221 | story 4's "this server has no test routes" spec and TC-24's broken-board spec, which are not running at the same time (`workers: 1`) |

Story 4's specs take a port *pair* (app + inspector) from where they are asked to
start, and move up in steps of two until both ports bind free - see "e2e tests that
start and kill a server" below. They therefore use whatever is free inside the
range, and the table is what they get when nothing is left over.

`wrangler dev` is started with `--ip 127.0.0.1 --port 24212 --inspector-port 24213`,
and the Vite dev server is pinned to `host: '127.0.0.1'` (with the default it
binds `::1` here and `http://127.0.0.1:24208` refuses connections).
Ports 24210/24211 are held by a `wrangler dev` process that this sandbox cannot
signal (`kill` is refused), so the e2e port is `AGENT_PORT_FIRST + 4` rather than
`+ 2`; the port stays configurable through `E2E_PORT` / `E2E_INSPECTOR_PORT`.
From story 5 the resolved value lives in one module, `tests/e2e/target.ts`, which
`playwright.config.ts` and the specs both import: boards are made by the server now, so
a test needs the port *before* it has a page, and a helper that reads it off a page's
own URL would have nothing to read it from.

## Browsers

The suite is written browser-agnostically and the app has no browser-specific
paths, but **this sandbox cannot launch Firefox or WebKit**: `firefox.launch()`
aborts the process (`SIGABRT`) and `webkit.launch()` aborts its `Playwright.app`
(`Abort trap: 6`) before a page exists. It is not a missing install (both
binaries are present, arm64, matching the Playwright 1.63 revision) and not a
product problem — a bare `firefox --dump-dom` also returns nothing here, so the
browser content processes cannot be spawned in this environment. Chromium runs
fine (it uses its own in-process headless shell).

`tests/e2e/setup.ts` therefore *probes* which browsers can launch and
`tests/e2e/fixtures.ts` skips a test only when its browser genuinely cannot start
(the skip message points at the `[e2e] browsers that cannot launch here` line
printed at the start of the run). Nothing is skipped on a guess, and on a machine
where Firefox/WebKit do start, the same 12 tests run there too.

To keep real coverage, the suite runs twice in Chromium: `chromium` (device pixel
ratio 1) and `chromium-retina` (device pixel ratio 2), which re-exercises the dot
grid, sub-pixel grid phases and the counter-scaled origin marker on a 2x surface.

WebKit here cannot synthesise Safari `gesture*` pinch events, which is why the
pinch handler is covered by the component test (TC-17) instead of e2e, as the
story's test strategy allows ("Not covered").

## Measurement notes (e2e)

Things measured on real browsers that the helpers account for:

- **Wheel deltas scale with the device pixel ratio**: `page.mouse.wheel(0, 120)`
  arrives at the page as `deltaY: 60` on a 2x surface. `wheelBoard()` returns the
  delta the page actually saw, so the "board moved by the wheel delta" claim is
  measured rather than assumed.
- **Computed transforms are rounded** to about six significant digits
  (`matrix(3.81471, ...)` for a zoom of 3.8147145625), so "the DOM caught up with
  the camera" is compared relatively (`waitForRender`).
- **Screenshots are in device pixels**: a 48 CSS px clip is a 96 px image at DPR 2.
  `shootRegion()` returns a `Shot` carrying the CSS size so a region is re-shot at
  the same CSS size (`differenceAt`).
- **Screenshots come back as colour type 2/6 PNGs**; `tests/e2e/helpers/png.ts`
  decodes them (all five PNG filters) so regions can be compared without a third
  party image library.
- The dot grid is a CSS `radial-gradient` painted on the board surface itself, so
  the pixel tests locate a dot from the computed `background-size`/`background-
  position` (`nearestDot`) and then compare rendered pixels around it.
- The origin marker (22 px crosshair with a `scale(1/zoom)` counter-scale) is the
  world-anchored reference for the ±1 px claims: its `getBoundingClientRect()`
  centre is where world (0, 0) is drawn.

## jsdom limits worked around (component tests only)

`tests/component/setup.ts` provides what jsdom lacks so the components can be
tested the way they run in a browser:

- `requestAnimationFrame`/`cancelAnimationFrame` are replaced by a frame queue
  (`drainFrames()`), because camera updates are batched onto a frame. This is the
  "rAF via fake timers" of the design.
- `window.innerWidth`/`innerHeight` are fixed at 1280×800 (the design's laptop
  board area), since jsdom reports 1024×768 and does no layout.
- `Element.prototype.setPointerCapture`/`releasePointerCapture`/
  `hasPointerCapture` are stubbed: jsdom implements no pointer capture.
- Safari's `GestureEvent` does not exist in jsdom, so gesture tests dispatch a
  `MouseEvent` with a `scale` property attached (the shape the handler reads).
- jsdom performs no layout, so `getBoundingClientRect()` is all zeros. Component
  tests therefore assert the rendered CSS (world layer `transform`, background
  `background-size`/`position` of the dot grid) rather than pixel geometry; exact
  pixel geometry (±1 px) is asserted in e2e, where real layout happens.

## Story 2: sticky notes

- **Moving a DOM element that has the pointer capture ends the drag.** Chromium fires
  `lostpointercapture` when the captured element is re-parented or *moved among its siblings*, so
  rendering notes in document drawing order - which changes whenever a note is brought to the
  front - cancelled a drag in the very event that started it: `bringToFront` re-rendered, React
  moved the element, capture was lost, and the note never moved. Notes are therefore rendered in
  a stable order (creation order, which never changes) and stacked with `z-index: <z>`; hit
  testing follows the painting order, so `document.elementFromPoint` still reports the top note.
  jsdom has no pointer capture at all, so no component test can see this: it is an e2e-only bug
  (TC-32 found it).
- **Page chrome needs a stacking order of its own.** `.board-toolbar` is rendered before the
  board viewport, and both are positioned, so the viewport painted over the toolbar and
  intercepted its clicks (Playwright reports this as "…intercepts pointer events"). Fixed with
  `z-index: 2` on `.board-toolbar`; `.zoom-controls` only worked because it happens to come after
  the viewport in the DOM.
- **React 19 schedules state updates that arrive outside `act()`** onto the scheduler queue (a
  MessageChannel task), so a component test that dispatches an event and then reads the DOM
  synchronously sees stale state whenever that event notifies `useSyncExternalStore` - which every
  Y.Doc write does. Every event helper in `tests/component/helpers.tsx` dispatches inside `act()`.
  Mutating the document directly from a test (rather than through a UI event) needs the same
  treatment.
- **A detached `Y.Text` cannot be read**: `toString()` on a `Y.Text` that is not attached to a
  document returns `''` and logs a warning. Tests read text through `getStickyText` after the
  `Y.Map` owns it, which is the state the app is ever in.
- **Drag threshold is exclusive**: `distanceSq < DRAG_THRESHOLD_PX ** 2` keeps a 2 px press as a
  select and 3 px starts the drag, matching the PRD ("a 2 px press is a select").
- **Counter-scaling page chrome inside the scaled layer**: each note element sets
  `--inverse-zoom: <1/zoom>`, and its toolbar, counter and fade use `calc(<px> * var(--inverse-zoom))`.
  They keep a constant size on screen without the components having to pass zoom around.

## Story 3: live collaboration (Workers runtime tests)

The integration project runs the real Worker and the real `BoardRoom` inside workerd, via
`@cloudflare/vitest-pool-workers`. Things that needed adapting to that harness:

- **vitest is pinned to `^4.1.11`.** `@cloudflare/vitest-pool-workers@0.22.0` has
  `vitest ^4.1.0` as a peer, so installing it alongside vitest 5 fails with `ERESOLVE`.
  `y-websocket@3.1.0` also needs `lib0` and `y-protocols` as direct dependencies (it imports
  them and does not declare them), which the client and the tests both use.
- **`compatibility_date` went from `2026-09-01` to `2026-08-22`.** The integration project
  reads the same `wrangler.jsonc` as `wrangler dev`, and the workerd binary that ships inside
  `@cloudflare/vitest-pool-workers` (its own nested `wrangler@4.124`) refuses a later date:
  `This Worker requires compatibility date "2026-09-01", but the newest date supported by this
  server binary is "2026-08-22"` — and the whole project then fails to start.
- **The pool is registered as a Vite plugin.** This version exports no
  `defineWorkersProject`/`defineWorkersConfig` (its `exports` map is `.`, `./types`,
  `./codemods/…`), so `vitest.config.ts` adds `cloudflareTest({ wrangler: { configPath:
  './wrangler.jsonc' } })` to the integration project directly.
- **Two tsconfigs.** `tsconfig.json` covers the browser side and the node/jsdom/Playwright
  tests; `tsconfig.worker.json` covers `src/worker`, `src/shared` and `tests/integration`
  with `@cloudflare/workers-types/experimental` and no `DOM` lib — the two environments
  declare different globals, and `WebSocket`/`Response`/`crypto` must not come from the DOM.
  `npm run typecheck` runs both. `tests/integration/env.d.ts` declares `Cloudflare.Env`, which
  is what `env` from `cloudflare:test` is typed as.
- **`npm run pretest:integration` builds the client.** The `ASSETS` binding serves
  `dist/client`, and TC-06 asserts the client is really served (including the `/b/<id>`
  SPA fallback), so the build has to exist; npm runs the `pretest:` hook automatically, so
  `npm run test:integration` stays as the story specifies.
- **A socket from `SELF.fetch` is a WebSocket pair end, not a browser connection.**
  `response.webSocket` must have `accept()` called on it before it carries traffic (`send`
  throws `You must call one of accept() or state.acceptWebSocket()` otherwise), so the harness
  client accepts it after its listeners are attached. A frame the room sends while the test is still
  awaiting the response is delivered afterwards, so tests always *await* a message instead of
  checking `received.length` synchronously.
- **Close codes are on the close event, not on the socket.** `ws.closeCode` stays `undefined`
  on this path; `event.code`/`event.reason` carry `1003`/`"unsupported message"`. The harness
  records the event's values (falling back to the socket's) so `expectClose(1003)` asserts the
  real close code in both directions — the room closing a socket and a client leaving.
- **The harness client reads every frame it receives, in the message listener** — the way
  `WebsocketProvider`'s `onmessage` does. Reading only while a test happens to be waiting meant a
  live update that arrived "while nobody was looking" never reached the client's document, which
  is exactly what TC-07 to TC-12 are about. `waitForSync` therefore polls the synced flag instead
  of driving the reads, and a test takes its place in the received log with `mark()` before the
  change it wants to see.
- **workerd gives that socket no `ping()` method** (`typeof ws.ping === 'undefined'`). Nothing in
  the spec's list needs one: keeping an idle connection alive is the room's awareness relay
  (TC-16 asserts the copy back to the sender), and the nightly e2e TC-29 watches a real browser
  stay `connected` for 45 seconds.
- **"no room was created" is asserted with `listDurableObjectIds`.** A room outlives a single
  test inside a run (the Worker instance is shared by the project's files), so tests never
  assert "these are all the rooms" — they assert their own id is present, or that the set did
  not grow. Every test gets its own board id for the same reason.
- **A literal `..` in the path is gone before the Worker sees it:**
  `GET /api/rooms/../x` is normalised to `/api/x`, which is not a room path, so the client is
  served (200) rather than a 400. TC-04 covers the ids that really are malformed (which includes
  the encoded `%2e%2e%2fx` and `..%2Fx`, both 400), and a second test asserts that a traversal
  opens no room either way.
- **`readSyncStep2` swallows a bad update.** `y-protocols` catches the `Y.applyUpdate` error,
  `console.error`s it and moves on unless the fourth `errorHandler` argument is given, so
  `BoardRoom` passes one: without it TC-15's invalid update would be ignored instead of closing
  that connection with 1003.
- **The room sends the newcomer a SyncStep1 and the client also sends its own** — the same
  exchange `WebsocketProvider` does, where either side may ask first. The room answers a
  client's SyncStep1 with a SyncStep2 on that socket only, and broadcasts a merged update to the
  others; that is the whole relay.

## Story 3: live collaboration (the browser side, and tests over several browsers)

- **`context.setOffline(true)` does not break a WebSocket that is already open.** Measured: the
  socket stays `OPEN` and keeps carrying messages; only *new* connections fail. So TC-27's outage is
  a pair of things - `window.__vidi6Connection.dropConnection()` (the provider's own `disconnect()`,
  exposed only in test builds) to end the live socket, and `setOffline(true)` so the automatic retry
  cannot get through. Going back is `setOffline(false)` then `restoreConnection()`, because the
  provider would otherwise sit waiting on its own backoff for no reason.
- **`y-websocket` reconnects on a timer whether or not the app asked for a connection.**
  `closeWebsocketConnection()` schedules `setupWS()` whatever `shouldConnect` says, so a dropped
  connection comes back by itself ~200 ms later. That is why "it stayed disconnected for 30 s" has
  to be enforced by the network, not by the client.
- **Edits made while disconnected are not lost and do not throw.** The provider's update handler only
  sends when the socket is open; anything else just stays in the local `Y.Doc` and goes across in the
  SyncStep1/SyncStep2 exchange when the connection returns. TC-27 asserts that as "six notes on both
  pages".
- **Connection counting is `page.on('websocket')`, not `page.on('request')`.** Playwright reports
  socket handshakes on its own `websocket` event; a test that wants "nobody reconnected while idle"
  (TC-29) counts those, and first proves the counter works by dropping a connection and seeing one
  appear.
- **Latency is measured from after the gesture, not before.** Playwright's mouse emulation costs
  ~1 s for a drag, and the thing worth reporting is how long the *room* took. `measureChange()` runs
  the action, then starts the clock, so TC-22's "move" is 3 ms of propagation and not 1.4 s of
  puppetry.
- **TC-23 compares the characters typed, not their order.** Yjs merges two people typing into the
  same note by interleaving their inserts; each person's own characters keep their order, but the
  other person's land in between. "Every character arrives" is therefore a count of each character,
  which is what the design's wording asks for; a single expected string would be a coin toss.
- **`StickyTextEditor` keeps a caret at the end of the note when a remote change lands.** Redrawing
  the textarea used to clamp the caret to its old offset, which - with two people typing - put the
  local caret *behind* the characters just typed, and the next keystroke went into the middle of the
  word ("green blue dre"). If the caret was at the end it stays at the end; if it was in the middle it
  stays where it was. TC-23 is only readable with this, and the rule has component tests (TC-23e,
  TC-23f) built from two real `Y.Doc`s synced with `Y.encodeStateAsUpdate`.
- **The capacity soak attributes each edit by comparing the board before it with the board after it
  (`touchedNoteId`).** With five people dragging things about, a click often lands on whichever note
  is on top at that point, and Playwright would wait seconds for a note to sit still. Clicks are
  therefore forced with a short timeout, and what really changed is read off afterwards. The soak
  then follows *that note* to the next page: a whole-board equality check can never hold while five
  people are editing, so it would report the polling timeout for every change.
- **The nightly tests are collected every time and do nothing unless asked.** Their titles carry
  `@nightly`; `npm run test:e2e` greps them out, `npm run test:e2e:nightly` greps for them, and they
  skip again unless `VIDI6_NIGHTLY` is set, so the long run has to be chosen on purpose. TC-30 opens
  `MAX_CONCURRENT_EDITORS` contexts and is chromium-only; TC-29 holds a board idle for 45 s and
  asserts the socket count never moves.

## Story 4: persistence (a room, its SQLite, and tests that damage it)

The board lives in the room's own Durable Object SQLite (`src/worker/board-store.ts`), and the
integration tests read it back with a second `BoardStore` over the same `ctx.storage` - that is
how a test knows it read the rows rather than remembered them. Things that needed learning or
fixing on the way:

- **Durable Object SQL is synchronous, so the room's constructor loads the board with a plain
  call.** `this.storage.sql.exec()` returns a cursor and never awaits. The first version wrapped
  that load in `ctx.blockConcurrencyWhile`, which left a pending RPC at the end of a test file and
  made the pool print `EnvironmentTeardownError: Closing rpc while "resolve" was pending` after an
  otherwise clean run. There is nothing to wait for, so there is nothing to block on.
- **The cursor API is `.toArray()` and `.one()`.** There is no `.all()` and no `.first()`; `.one()`
  throws when the cursor is empty, which is the right thing for "the one row that must be there".
  `transactionSync(fn)` is on `DurableObjectStorage`, not on `SqlStorage`.
- **`runInDurableObject` hands over the instance, not its state**, and `ctx` is `protected` on
  `DurableObject<T>`. A test that wants the room's database writes
  `(room as unknown as { ctx: { storage: DurableObjectStorage } }).ctx.storage`.
- **A change is an update whose origin is one of the room's sockets** (`cameFromAClient`), not "an
  update whose origin is not null". The difference is not academic: a bare write to a note's
  `Y.Text` - which is what `getStickyText(doc, id).insert(...)` is - carries origin `null`, and so
  does the update Yjs fires when it integrates bytes it had to hold back. The first has to be
  stored, the second must not be. So the room asks the positive question, "did this come off a
  socket?", and the test routes mark their own writes with `TEST_HOOK_ORIGIN` to be treated as
  changes as well. Nested `doc.transact` keeps the *outermost* origin (verified with a probe),
  which is what lets that marking survive the model function's own transaction inside it.
- **The row count of a board is a formula, and the tests state it:** rows = (connections ever
  made) + 2 per note. Each client's own `initDoc` reaches the room as its own update, when that
  client answers the room's SyncStep1; a document that never ran `initDoc` contributes nothing.
  That is why TC-18's quiet socket carries a bare `new Y.Doc()`: it has nothing to say back, so
  nothing is written after the room is evicted and the test starts measuring.
- **A test that is about to damage storage waits for the rows, not for the sender's screen**
  (`settle(board, texts)` in the room tests, which reads the log with its own store). Waiting on
  the sender's `snapshot()` is a race: a client applies its own change locally and at once, so the
  assertion was already true before the update had crossed the socket, and the compaction or
  damage that followed was measured against a board that had not been written yet. It showed up as
  one row missing from a snapshot, and as a byte count exactly half of what it should have been.
- **`wrangler.jsonc` has no `extends`.** wrangler 4.124 rejects that field, so the integration
  project adds its binding through the pool plugin instead:
  `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: {
  TEST_HOOKS: '1' } } })`. `miniflare: { vars: ... }` does not reach the Worker; `bindings` does.
  The e2e `wrangler dev` gets the same variable on its own command line, so the production config
  stays free of those routes.
- **A `fetch` in a workers test goes to the internet.** `http://localhost/...` is not the Worker
  under test; `SELF.fetch` from `cloudflare:test` is. Reaching for the global one produced
  `uncaught exception; source = Uncaught (in promise); stack = Error: internal error; reference =
  ...` out of workerd, and a response status that had nothing to do with the Worker.
- **A quarantined row leaves a hole in the log that has to be closed by hand.** When a row does not
  decode, `Y.applyUpdate` throws partway through it and the rows after it are *deferred* by Yjs
  rather than dropped (`doc.store.pendingStructs`), so the board comes back without everything
  that followed the damage. `BoardStore.load` closes the clock gap by handing Yjs a **GC struct**
  over `[last good clock, deferred clock)` - "there were changes here, they are gone" - after which
  Yjs integrates the deferred bytes normally and only the damaged row's own content is missing
  (TC-08). `gapFillUpdate()` is pure and unit-tested; the room never has to know.
- **`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "resolve" was pending` is the
  runner's, not the suite's.** It comes and goes at the end of `npm run test:integration` - including
  when only story 3's three integration files are run, before any of this story's code was in the
  picture - and the run exits 0 with every test passed. The one place the suite itself provoked it
  (a `blockConcurrencyWhile` in the room's constructor) is gone, per the first note.

### Story 4: the client side, which is a different kind of bad news

`ConnectionState` gained `load_failed`, and it is the only state that locks the board. Notes that
came from getting the mapping and the lock right:

- **A close code is the only thing that distinguishes "unreachable" from "not there".** Both look
  identical to the status listener: the socket opened, and now it has not. So `BoardLink` gained
  `onClose`, and y-websocket's `connection-close` is what feeds it. Two details of that event
  matter. It fires *before* the `disconnected` status, so a listener is told what the room said
  before it is told the room is gone; and it carries `null` rather than a code when this page hung
  up itself (`provider.disconnect()`, and the "no message received" watchdog). A rule written as
  "any code except 4500" is fine with that; a rule written as "no code means something went wrong"
  would lock the board every time a test or a laptop lid ended a socket.
- **4500 is deliberately outside the range y-websocket treats as final.** Its
  `defaultShouldReconnect` refuses to retry codes 4400-4499, so a room that wanted to say "stop
  trying" would have to pick a code in that band - and then the client would stop retrying and the
  badge's "Retrying…" would be a lie. 4500 is the code just past that band: the room says it could
  not open the board, and the client keeps knocking anyway, which is what makes recovery without a
  reload (TC-24) work at all.
- **While the board is in `load_failed`, nothing but a sync changes the badge.** The provider's own
  retries open sockets and lose them, and each of those would otherwise flip the message between
  "This board couldn't be loaded" and "Reconnecting…" - the second being the one thing that is not
  true of this situation, because nothing is reconnecting to anything; the room answers every one
  of those attempts and refuses them.
- **jsdom does not apply the stylesheet, so "red" is tested where it is written.** The component
  test asserts the class (`connection-status--load_failed`), that the rule for that class names
  `var(--connection-error)`, and that the value of that custom property is a red (R greater than G
  and B). A state rendered with a class nobody styled would pass a DOM-only test and show the user
  an amber badge. In the browser the same claim is checked as a computed colour.
- **`import.meta.url` is not a file URL in the component project**, since that project runs in
  jsdom: `readFileSync(new URL('../..', import.meta.url))` throws `The URL must be of scheme file`.
  The stylesheet is read relative to the project root instead, which is where every test here runs
  from.
- **The tests quote the message exactly, including its characters.** The design writes
  `This board couldn't be loaded. Retrying…` with a plain ASCII apostrophe and a real ellipsis, and
  that is what the source contains and what three tests compare against. A rewording should fail a
  test rather than drift.
- **`canEdit()` in the test helpers reads the interface, not the implementation.** It returns
  whether the Sticky note button is enabled, not what the app's own `canEdit` says about the state.
  A gate that exists in the handler and never reaches the control - the case where the button looks
  usable and then does nothing - is exactly what a test that called the function would miss.
- **The lock is one value handed down, not a check in each control.** `App` computes
  `canEdit(connection)` once and passes it to the toolbar, the surface, the notes and the keyboard
  shortcuts. Mutating any single one of those (a `Toolbar` without its `disabled`, an `App` that
  ignores the state) fails 5 to 12 component tests, which is the check that the lock has no holes.
- **jsdom gives back the same `backgroundPosition` string however the camera moves**, so a test
  that wants to know whether the board can still be moved around asks `window.__vidi6.getCamera()`
  - the camera itself - rather than reading the CSS that was derived from it. And a wheel without
  ctrl *pans*; zooming needs ctrl or meta.

### Story 4: e2e tests that start and kill a server

`tests/e2e/helpers/wrangler-process.ts` runs a `wrangler dev` per test, with `--persist-to` its own
directory, and these three things are what make the results mean something:

- **Every address is absolute, and rebuilt from the port on every navigation.** The suite has a
  `baseURL` (the shared dev server, needed anyway because the global `webServer` is what builds
  `dist/client` in test mode), and `page.goto('/b/xyz')` resolves against it. TC-19 and TC-20 passed
  for a while like that: they were opening their board on the shared server, which is never
  restarted, and reporting that the board had survived. `newBoardPath()` returns a path and
  `urlFor(path)` re-addresses it, because a server that had to change ports on restart would
  otherwise have its pages reopened at an address that belongs to somebody else afterwards.
- **A server is started only on a port that was free, proved by binding to it.** `lsof` is not
  reliable in this sandbox (it reports nothing about a port that is demonstrably held), so the
  helper binds and releases the pair through `node:net`. The leftover case is real, not
  hypothetical: a run killed on a timeout never runs its `finally`, so the `wrangler dev` it started
  keeps answering, and the next test's requests get answered by a process with a configuration it
  did not choose - which is how "these routes do not exist" reported 200 for five routes that were
  never registered on the server it had started. Port pairs in use: 24212/24213 shared suite server,
  24214+ persistence, 24218+ the routes guard, each moving up in steps of two when a pair is taken.
- **The kill is a signal to the process group.** `wrangler dev` spawns workerd as a child; killing
  only the child, or only the parent, leaves something holding the port and holding the board in
  memory. `detached: true` at spawn, `process.kill(-pid, 'SIGKILL')`, and then wait for the port to
  be free again - and complain loudly if it is not, because that means a foreign process is
  listening there.
- **A board is only as tested as the way it was made.** TC-21 does not call the compaction route:
  4000 writes cross the room's own 500-row threshold often enough that the room folds its own log
  while the notes are being seeded, and the test asserts it did (1 snapshot chunk, ~1 log row left).
  An earlier version asked for the fold explicitly and still passed with `append` deleted from the
  room, because the only thing that had ever written storage was the test's own `compact` call.
- **A server that restarts does not get to move.** TC-24 leaves pages open across the restart,
  because the thing it asserts is that those pages recover without being reloaded - and a page
  reconnects to the address it was loaded from. So `restart()` insists on the port it started on and
  fails loudly if something took it while it was stopped, instead of drifting to the next free pair:
  a server that came back on another port is a server those pages will never find, and the test
  would then be waiting for a recovery that cannot happen, for a reason that has nothing to do with
  the code under test. (It is also how it would end up talking to one of the suite's other servers.)
- **The wait for a recovery is not the wait for a change.** `E2E_EVENTUAL_TIMEOUT_MS` (15 s) is how
  long a change that has already been made may take to arrive; the board coming back is bound by two
  timers instead - the client's reconnect backoff (up to `RECONNECT_MAX_BACKOFF_MS`, 10 s) and the
  room's once-per-`LOAD_RETRY_MIN_INTERVAL_MS` (5 s) re-read - so TC-24 polls against their sum plus
  room. Measured here: the board was a board again 5.9 s after the storage was repaired, on three
  pages that were never reloaded. Reusing the 15 s wait would have made this test fail on a machine
  that was merely slow, which is the kind of flake that gets a `sleep` added until the test asserts
  nothing.
- **"Red" is the pill, not the letters.** The badge has been white text on a coloured pill since
  story 1 (amber to wait, green for a moment), so `load_failed` sets `background:
  var(--connection-error)` and the e2e assertion reads `backgroundColor` - a first version asserted
  `color` and failed with `rgb(255, 255, 255)`, correctly: the text is white on every badge, and
  what is red about this state is the pill. Both are asserted, and the component test keeps checking
  the mapping close-code → class → property → red hex that jsdom cannot paint.
- **A locked board is mutated in the browser, not only in jsdom.** Two holes were planted and both
  were named in the failure: `Delete` ungated in `App` ("the Delete key changed the board") and the
  drag path in `StickyNote` ungated ("dragging a note changed the board") - with the toolbar button,
  the bin and the swatches all still disabled, which is what a test that only looked at `disabled`
  attributes would have missed. Rebuilding `dist/client` is part of such a run: the shared webServer
  serves static files and is reused, so a mutation that is not compiled is a mutation that is not
  tested. (Backups for these runs go under `.tmp/`, not `/tmp` - the sandbox refuses the latter, and
  a `cp` that fails quietly leaves the mutation in the tree.)

## Story 4: what the automated tests deliberately do not cover

The design's "Not covered" list, with what was done instead and what would break if the reasoning
behind each omission were wrong. This is written down because an omission nobody wrote down looks
like an oversight the next time something breaks.

- **The output gate's ordering.** That a Durable Object holds an outgoing WebSocket message until the
  storage writes made before it are durable is a platform guarantee, and there is nothing here to
  test it against: Miniflare's SQLite has no disk latency for a race to hide behind. What *is*
  asserted is the half that is mine - `boardChanged` inserts the row before it broadcasts, in the same
  turn (`tests/integration/board-room-persistence.test.ts` asks a socket that receives a change to
  read the log and finds the row already there). If the guarantee were false, the failure would be
  exactly the one the story forbids: a change on someone's screen that a restart loses.
- **Production eviction, hibernation timing, and real Cloudflare restarts.** What is tested is the
  room's own hibernation path - TC-18 reconstructs the object out of `ctx.getWebSockets()` and
  delivers a message to a socket that was accepted before it went away, which is the behaviour that a
  wrong assumption about hibernation breaks - and a real process restart over a real file (TC-19 to
  TC-21, TC-24). The platform's schedule is not tested: how fast an idle object is evicted, and
  whether a `stateReset` ever happens. Nothing in the room depends on either: every wake re-reads the
  storage, and there is no cache to be wrong about.
- **Storage quota exhaustion.** No test fills a board's database. A quota error arrives as a failed
  `append`, which is the save-failure path that *is* tested (TC-13/TC-14: the change is not
  broadcast, the sockets are closed with 1011, and the client that made it still has it and puts it
  back in on reconnect). So a quota error is not silently lost - but no test says it is handled
  well, and no test says the room keeps working afterwards.
- **Wall-clock load time as a pass/fail criterion.** TC-21 reports navigation-start-to-last-note
  against `BOARD_LOAD_BUDGET_MS` (1182 ms for 2000 notes on this machine, budget 3000 ms) and does
  not assert it, because the model, the browser and the server share one machine and an asserted
  budget here is a failure that means "somebody else was using the laptop". Nothing measures the
  internet: `wrangler dev` is localhost, so real network latency is not in any number in this repo.
- **Boards bigger than `PERSIST_TESTED_NOTES` (2000).** The measurement stops where the testing
  stops: the cost per note is observed up to 2000 notes and not extrapolated beyond them. A board
  with 20 000 notes is expected to work and is not known to.

## Deviations

- None from the story's acceptance criteria. The e2e port differs (see Ports),
  Safari pinch gestures are not covered in e2e (see Browsers), which the story's
  test strategy explicitly allows, and Firefox/WebKit tests skip themselves on
  this machine because those browsers cannot be launched here (see Browsers).
  Counted at the time of writing, over the whole suite: 89 e2e tests run here and 107
  skip themselves for browser reasons. The stories 1 to 3 tests and this story's TC-22
  to TC-28 are browser-agnostic and so run in chromium and in the retina project too;
  TC-19 to TC-21 and TC-24 are chromium-only, because they start, corrupt and kill a
  server of their own and doing it four times over proves nothing extra; the nightly
  capacity soak (TC-30) is chromium-only by design. (An earlier line here said "68 e2e
  tests run, 68 skip themselves", which was a true count of a tree that no longer exists.)
- Story 4's task 3 puts the e2e persistence tests in "its own Playwright project
  without the shared webServer". They are in the ordinary projects instead, and
  skip themselves on any browser but chromium - TC-19 to TC-21 and TC-24 alike.
  The reason is that the global
  `webServer` is what builds `dist/client` in test mode (`npm run build:test`,
  `reuseExistingServer: true`), which every spec in the suite including these
  depends on; a project that excluded it would have to build the client itself,
  and two builds of the same directory racing each other is a worse flake than a
  `test.skip`. What the task asked for - that these tests do not talk to the shared
  server - holds: they open their own server and address it absolutely.
- The room's test routes answer 404 `not found` from the Worker when
  `TEST_HOOKS` is not set, rather than falling through to the asset server. The
  asset server answers a `POST /__test/...` with the SPA's `index.html` and a 200,
  which for a route that does not exist is the wrong status and the wrong body; the
  test that checks "this server has no test routes" would have to allow for that.

### Story 5: deviations

- `nextBoardPageState` takes a fourth argument, the board id, which the design's contract
  line does not list. The reason is the `ready` state: it is the board's own id, and a page
  cannot render a board, a Share panel or a title without it. The three arguments the design
  names are the ones that decide the transition; the fourth is carried through to the state
  that says "this one".
- A board page asks the server whether the board is there on every mount, including when the
  navigation came from a **New board** press that was told the board was made a moment ago.
  The design allows a page to remember that an id was answered with `exists` and go straight
  to ready; this one does not, because the answer belongs to the mount that asked for it, and
  the state that would carry it between mounts would be a second copy of the truth that can
  disagree with the first. The cost is one 2-byte request per navigation, which TC-26 measures
  as part of the click-to-board time it prints.
- `src/client/board/BoardSurface.tsx` is a file the design's Files table does not name. The
  table splits `App.tsx` into `router.ts` and `pages/BoardPage.tsx`; between them sits the
  board UI of stories 1 to 4, and both files would have to own it. So `App.tsx` keeps routing,
  `pages/BoardPage.tsx` keeps the existence check, and `BoardSurface` is what the board page
  renders when the answer is yes - which is also what lets the component harness drive 136 old
  tests through the router instead of around it.
- Story 4's `cameFromAClient()` in `src/worker/board-room.ts` is changed here (see the
  durability note above). It is another story's file, and the change is not part of this
  story's acceptance criteria; it is a fault in the durable path that this story's request
  pattern exposed, and leaving it in place would have meant shipping a board that loses what
  it was shown. The story 4 suite still passes unchanged, and one test was added to that
  story's own file to say the behaviour out loud.

## Story 5: links, and the pages that stand behind them

- **A malformed board id is "not found", at both doors.** `GET /api/boards/abc` answers 404
  and `GET /api/rooms/abc` answers 404 before a Durable Object is named (TC-07), which is what
  keeps the second half of the id rule true: a string that cannot be an id must not be able to
  spawn the storage of one. A 400 would be the pedantic answer and would cost the client a
  second kind of failure to tell apart from the first: from the person's side, a link typed
  wrong and a link to a board that was deleted are the same event, and the design spends a
  whole page on it (`share.not_found`). So `BoardPage` decides "this is not a board id" before
  it sends anything (TC-19), and the server says the same thing when something else sends it.
- **The client asks before it connects, and the room stopped opening boards.** Stories 1 to 4
  treated `/api/rooms/:id` as the place a board comes from: connect, and the board exists
  afterwards, in whatever browser got there first. Story 5 takes that permission away, because
  a board has to exist before the first link is sent, and because "any address makes a board"
  and "an unknown address says so" cannot both be true. A board page now sends `GET
  /api/boards/:id` and opens the WebSocket only on a 200 - which also means the page never
  fails a WebSocket it was never supposed to try. The room's `fetch` still serves everything it
  served (load, join, wire messages, `__vidi6Board`), and the story 4 test hooks still work on a
  board id they are given, because those hooks address a board rather than create one.
- **A WebSocket the runtime built is not a `WebSocketClient`, and story 5's timing turned that
  into a board that forgot.** Story 4's `cameFromAClient()` asked whether the origin of a change
  was `instanceof WebSocket`, which is true of every socket the room accepted itself through
  `ws.accept()` and false of the one the runtime constructs for the client's first frame in
  Miniflare: the load and the welcome are not client changes (they are the room answering), and
  the durable path dropped them. It did not matter while the first load was the last thing that
  touched a board: `boardChanged` writes the row before it broadcasts, so the first change a
  person made put the board into the log, and every write after it carries the snapshot forward.
  With story 5 there is a request between the load and anything else - the existence check - and
  when that request is what wakes a cold object and nothing at all follows, the object is left
  holding a board it has read and never stored, and the next wake reads an empty board.
  `tests/integration/board-room-persistence.test.ts` says it as a test: load a board over a real
  WebSocket, destroy the object without any client change, wake it, and find the board - the
  test fails with the old line and passes with the fix. The fix is to accept `WebSocket` as
  well, and nothing wider: a change that came from a socket the room did not accept is not
  something to store, and the load is the room's answer to a question the client asked, not a
  client's edit. What was already stored is untouched - the durable path still ignores the load
  in the sense that matters, which is that a load writes nothing (TC-06/TC-09: a board probed by
  a stranger has no rows at all, not even a snapshot).
- **A board page mounts a moment after the address bar moves.** The page asks the server first,
  so `page.goto('/b/<id>')` returns while the page is still holding the question. Reading the
  document hooks (`window.__vidi6Board`) at that moment throws, and Playwright's `expect.poll`
  treats an error thrown by the thing it is polling as the assertion failing rather than as a
  condition not yet true - which produced failures that read "the e2e suite needs the test
  build" on a server that was serving exactly that build. `waitForBoard(page)` from
  `helpers/boards.ts` is the honest version: it asks whether the board is mounted, by name, and
  waits. It is what every spec - including the older stories' - calls after a navigation, and
  `openBoard()` calls it too, because every spec that follows it reaches for the document.
- **The e2e helpers now make boards, and one helper's meaning changed.** `openBoard()` and
  `openParticipants()` create a board through the API before navigating (a board page is no
  longer what the home page is), `Server.newBoardPath()` does the same on the server it started,
  and `newBoardUrl()` - which used to mean "a board, which the first navigation will make" - now
  means "an id nobody ever made", which is exactly what TC-27 and TC-31 want. Every id in every
  spec still comes from `newBoardId()`; the two specs that seed boards and the two that want an
  unknown address are the ones that read that meaning directly.
- **The component harness renders `App`, and `BoardSurface` is what the board page renders.**
  Story 1 to 4's component tests asked for a board by rendering the board's root; that root is
  now `BoardSurface`, and rendering it directly would leave the router, the pages and the
  existence check outside every one of the 136 tests the old stories own. So `renderBoard()`
  renders `App` at `/b/<id>` with a stubbed existence check and gets to the board the way a
  person does, then waits for the board to mount in the same fake-time loop it already used -
  the board appearing is the first thing those tests do rather than a thing they assume. What
  they assert is unchanged.
- **The Share panel treats a clipboard that says no as an ordinary answer.** `writeText` can
  reject (a permission the person refused) and can throw out of the call (a browser without the
  API in that context); both leave the link selected in the field with the keystroke written
  under it, which is why the panel does not consider a rejected promise a bug in itself. The
  selection is read back and asserted in the component tests (TC-23/TC-24) and in e2e (TC-29),
  because "we tried to select it" and "the keystroke will copy the whole link" are different
  claims.
- **The tab says which board it is.** `BoardSurface` sets `document.title` to `Board <id> - vidi6`
  while it is mounted and puts the old title back when it goes. The design does not ask for it;
  it is the consequence of a board having an address, which is that a person can be handed three
  of them and cannot tell them apart by looking at the tab.
- **The link is the only secret, so nothing travels with it.** `<meta name="referrer"
  content="no-referrer">` is in `index.html`, and e2e checks it is in the served page and that
  the board page itself asks for nothing beyond its own origin. A board address is 22 characters
  of randomness and no access control; the page's own address is the one thing that must not
  leak to a third party through a subresource, and there are no subresources to leak it to.

## Story 8: undo, and what one person's history holds

- **The controller lives with the document, not in `App`.** The design's §5 builds it in
  `App` and passes `onUndo`/`onRedo` down as props; `App` in this codebase is a router that
  never holds a `Y.Doc` - the document is made in `BoardSurface`, which is also where the
  toolbar, the shortcuts and the object list are assembled. `useUndoController(doc)` in
  `BoardSurface` is the same object with the same lifetime (one per board tab, `destroy()`
  when that board unmounts), and three things read it: `<Toolbar undo={undo}>` for the
  buttons, `useBoardKeys({ undo })` for the shortcuts, and the `undo` prop on the object
  registry for the step boundaries. The callbacks are still one object (`UseUndoResult`)
  so the components do not care which of the three they came from.
- **Making the controller survive React's double-mount is not optional.** A controller
  created in `useState` and destroyed in the cleanup of an effect is destroyed on
  StrictMode's first pass and then handed to a render that still holds it, so Undo fires on
  a manager whose listeners are gone and does nothing - silently, and only in tests, since
  StrictMode is not in the production tree. `useUndoController` keeps the controllers it
  has destroyed in a `WeakSet` and builds a fresh one for the remount. Story 8's own
  component tests are what caught this; the pattern is worth copying for any future
  per-document object with a `destroy()`.
- **"Personal" means by transaction origin, not by person.** `trackedOrigins` holds
  `LOCAL_ORIGIN` and nothing else, so TC-03's "a change with no local origin at all" is
  what the filter is written against: a story-14 identity would work the same way and
  change nothing here. Story 9's free text and story 16's comments write with
  `LOCAL_ORIGIN` like everything else, so they are in this history already; a *second*
  Y.Map for comments needs `UndoController.addScope()` (a five-line passthrough in
  `undo.ts`, because `Y.UndoManager`'s scopes are per `AbstractType` and the objects map
  cannot know about it).
- **One press consumes one step, and a step can have nothing left to do.** When somebody
  else deletes the note a person was working on, that person's next Undo pops a step whose
  inverse has no effect on the board and stops there: the board does not move at all
  (TC-07), and the step is gone from the history. `undo()` returns `true` for it, because
  the contract is about steps and not about pixels; a test that reads the return value as
  "the board changed" would be wrong.
- **`Ctrl+Y` is not claimed.** The design lists it as a redo alias. Chromium performs
  `Ctrl+Y` itself inside a focused textarea - the keydown arrives with the editing already
  done, so a page handler cannot be the thing that decides - and outside an editor it is
  not a gesture this board can honour either. `Ctrl+Shift+Y` is left alone exactly as the
  design says. The Redo tooltip therefore names only the two shortcuts that are
  implemented; both are tested, and the tooltip carries "nothing to undo" / "nothing to
  redo" when the button is disabled (TC-18 asserts the design's wording is still in it).
- **TC-12 and TC-13 are unit tests, not component tests.** They need the clock moved past
  the 500 ms capture window, and `vi.useFakeTimers()` in the component project has no
  MessageChannel polyfill for React 19's scheduler (see "jsdom limits worked around"
  above), so a render never finishes and the project's own 20 s teardown fires before the
  first assertion does. They run in the unit project against a real `Y.Doc` and a real
  controller instead, with `lib0/time`'s `getUnixTime` mocked, which is the only clock
  `Y.UndoManager` reads; the component project proves the *boundaries* (TC-14 to TC-17),
  which is the half of the story that needs the real gesture code. Mocking `lib0/time` at
  all needed `server.deps.inline: ['yjs', 'lib0']` in the unit project - see the comment in
  `vitest.config.ts` - because otherwise yjs loads its own untouched copy of the module and
  the mock is invisible to it.
- **The design's "one sticky width (240 world units)" is not this codebase's**: a note is
  `STICKY_SIZE_WORLD` = 200 world units, so its top-left is 100 units left of its centre.
  The component tests' drag distances are written in terms of the constant, not the number.
- **Undo e2e tests have to count steps.** Making a note is one step; typing in it is
  another (the editor closes the capture window when it opens and when it closes, which is
  what makes them come back separately). `tests/e2e/undo.spec.ts` therefore has `makeNote`
  for the first and `writeIn` for the second, and a spec that made a note, typed in it and
  pressed Ctrl+Z once was asserting that an *empty* note disappears - which is not what the
  board did.
- `tests/unit/peer.ts` (the simulated remote peer) and `tests/unit/undo-history.test.ts`
  are added to the two tsconfigs in the same shape story 7 left: TC-03 needs the real
  `LOAD_ORIGIN`, which only exists in the Worker's storage module, so `peer.ts` imports a
  Worker module and the main program must not see it.

## Story 9: free text, and the box a piece of text needs

A text object is the first board object with no dimensions of its own: its width is
either a measurement or a request, and its height is a measurement always. Most of what
this story had to learn is about keeping those two statements true in the browser, and
about the fact that the board's own claim ("this box is 600 × 78") and the browser's
claim ("these words drew on five lines") are two different facts that a test has to
compare rather than assume agree.

- **The Text tool takes the pointer in the capture phase, and that is not an
  optimisation.** A browser finishes *every* drag with a `click` at the point the
  pointer was let go. The first version of the tool let a press reach the note under it
  (the viewport only refused to pan), so dragging a note while the Text tool was up
  moved the note and then wrote a stray text object where the drag ended. A press in
  Text mode is now recorded and stopped on its way down, which makes the rule
  sayable in one sentence: while the tool is up, a click writes and nothing else
  happens. Rearranging the board is what the other tool is for.
- **The double-click guard carries a time, not a flag.** Text mode switches itself back
  to Select as it places an object, so the double-click that follows a Text-mode click
  arrives in Select mode and cannot be recognised by asking what the tool *is*; and a
  boolean that is never cleared eats the next double-click too, minutes later, so a
  person who clicked once and then wanted a note got nothing. `DOUBLE_CLICK_WINDOW_MS`
  (500 ms, in `config.ts`) is how the board knows two clicks are still one gesture.
- **An empty text object is not board content, and undo does not bring it back wrong -
  but it does bring something back.** Placing an object and then typing nothing leaves a
  box with no words in it; the editor removes it when it closes (`deleteIfEmpty`), with
  no undo boundary on either side, deliberately: `Y.UndoManager` merges the create, the
  empty edit and the removal into one step whose content is the object *as it was at the
  moment it was deleted*, which is empty - so an Undo of that gesture reinserts an empty
  object rather than nothing. The story's acceptance is about what the board *looks like*
  afterwards (TC-31: nothing drawn, a marquee over the spot selects nothing) and does not
  speak of undoing an abandoned object, so no test claims anything about it. What *is*
  tested, in a component test and in e2e TC-28, is the case a person actually does: a
  text object with words in it, deleted, and brought back whole - a whole `Y.Map` is one
  step, so words, size and measured box all return.
- **Who measures is a rule about origins, not about components.** The box is rewritten
  whenever the text or the size changed *locally* (`LOCAL_ORIGIN`), and never because a
  colleague's change arrived; otherwise two people typing into the same object would
  write two different measurements of the same characters on every keystroke, and the
  board would flicker between them. `useTextBoxSync` keeps its remeasurers in a
  `WeakMap` keyed on the `Y.Doc` (a board's, not a component's, because the object that
  changed may not be the one on screen) and TC-12/TC-13 are written against the origin
  rather than the DOM, because "did my screen just measure it" has no visual answer.
- **Real font metrics exist in the browser and nowhere else in this repo's test
  projects.** jsdom's `HTMLCanvasElement.getContext` returns null (it prints *Not
  implemented: HTMLCanvasElement's getContext*), so `createCanvasMeasurer` falls back to
  `estimateWidth` - a ratio of the font size - and every component test therefore
  exercises the layout through an injected fake measurer or through the estimate. That is
  why TC-26 to TC-28 are e2e: they are the only place where the width that gets stored
  came from a real font, and where the wrapping the layout predicts can be compared with
  the wrapping the browser drew (`Range.getClientRects()` on the text node gives one rect
  per line box). A helper that counts drawn lines refuses to answer while the object is
  being edited, because a textarea keeps its line boxes where the DOM cannot see them:
  it throws rather than reporting zero, which would pass a `toBeGreaterThanOrEqual(1)`
  style assertion in the reader's head and mean nothing.
- **The height of a text object is written by the measurement, so the registry needed a
  second kind of resize.** `resizable: true` was never quite true for text: two handles,
  and only a width to drag. `handles: 'horizontal'` is asked of *every* object in the
  selection and the reduced pair is drawn only when all the resizable types agree, which
  is what keeps `text.mixed_handles` honest - text next to a note is a group, a group has
  corners, and the text inside it is scaled along with the rest rather than rewrapped.
  `resizeTo(doc, id, rect, sole)` is the write half: `sole` is the only case in which a
  handle drag means "this wide" rather than "this much bigger than it was", and the
  gesture still moves and scales everything that has no opinion of its own in one
  `resizeObjects` call, so a group resize stays one transaction.
- **The text of a text object is a `Y.Text`, so two people typing into one object is the
  story 3 problem again** - and the same answer holds: `applyTextDiff` is a prefix/suffix
  diff, the merge interleaves, and "every character survives" is a claim about the count
  of each character, not about the resulting string. e2e TC-29 asserts per-character
  counts plus convergence, and a length that is the sum of the three contributions.
- **`getNotes()` returns every object, which story 9 quietly changed.** It was never
  called that in the helpers: it always returned whatever is in the `objects` map, and
  until now that map only ever held notes. Text objects went in without a single change
  to stories 7 or 8 - selection, marquee, move, group resize, z-order, undo all work
  because they were written against `ObjectSnapshot` and a registry - and the e2e
  helpers are what showed it: `docNotes()` had to grow a type filter, and
  `docObjects()`/`docTexts()` are the honest versions.
- **`board-model` does not import the text module.** A text snapshot has to carry `size`,
  `widthMode` and the text itself, and `objectSnapshot()` is where snapshots are built -
  so it asks a per-type reader registry (`registerObjectSnapshotReader`) that
  `shared/objects/text.ts` fills at module scope, instead of importing it and asking
  `board-model` to depend on a type it must not know about. `TextSnapshot.createdBy` is
  optional on the text snapshot only: the `ObjectSnapshot` base has no such field, and
  inventing one there would be story 14's decision made early. For the same reason
  `BoardViewport` takes an `identityId` that nobody passes - this build has no idea who
  the person behind the pointer is, and a text object is created without attribution
  rather than with an invented name.
- **Two things in the interface are worded slightly differently from the design.** The
  Sticky note button's visible label is now "Sticky note (N)", because story 9 put a
  shortcut on that button and the label is where a person looks for a key; the accessible
  name is still exactly "Sticky note" and the tooltip is the design's own sentence, so no
  existing test was re-worded to accommodate this story - only a component test that
  quotes the new label was added. And `src/client/objects/textLayout.ts` is the design's
  `textMeasurement.ts` under the name story 9's own task list names it (its unit test is
  `tests/unit/text-layout.test.ts` rather than the design's `measureText.test.ts`), plus
  one file the design does not name at all: `TextEditor.tsx`, which is `StickyTextEditor`
  generalised to any `Y.Text` - the sticky editor stayed as a thin wrapper over it so
  story 2's tests still drive the code they always drove, and a text object gets an
  editor without a second copy of the caret-keeping rules.
- **Component tests of *received* changes need `act()` around the peer's transaction**,
  which is the React 19 note from story 2 arriving in a new guise: `peer.transact()` on
  its own leaves the store notification queued on the scheduler, so a test that reads the
  DOM afterwards sees the board as it was before the change. `tests/component/peer.ts` is
  new (shared by this story's files) and its `asPeer()` is the version that renders;
  a test that only reads the document can keep using the bare `peer.transact()`.
- **One selection rule cost a test day, and it is story 7's, correctly.** Clicking an
  object that is already selected keeps the whole selection (it is the press that starts a
  group move, not the press that selects). A test that wants to select one object out of a
  group must therefore click empty board space first; TC-21 does, and says so.
- **Timing that only shows up in the browser:** a Playwright drag costs on the order of a
  second of wall clock, so e2e TC-27 does its three drags inside a five-second test and
  TC-30 - `MAX_CONCURRENT_EDITORS` contexts each pressing T, clicking and typing, then a
  full-board comparison on every page - gets 300 s. `expectSameBoard` needed no change for
  text objects: it compares `ObjectSnapshot`s, and `text`/`size`/`widthMode` came along as
  part of the snapshot this story added.

## Story 11: a pen, and the difference between where the mouse went and where the ink is

A stroke is the first board object whose *shape* is stored, and most of what this story had
to learn is about the three places that shape exists in: the trail of points the pointer
left, the box the model stores around it, and the curve the browser actually paints. Those
three are not the same geometry, and a test that assumes they are is a test that fails for
the wrong reason.

- **Where the ink is is where it is *painted*, and a stored point is often not on it.**
  `smoothPath` draws a quadratic through the midpoints of the trail, which rounds corners:
  a zigzag whose stored peak is 30 units above its neighbours has its painted line pass
  about 22 units above them, some seven screen pixels away from the point that made it -
  further than `STROKE_HIT_TOLERANCE_PX`, so a test that clicks "at point 4 of the stroke"
  by reading `points[8]` and converting through the camera clicks on empty board and
  blames the hit test. `strokePointOnScreen` therefore asks the browser where its own line
  is: `getPointAtLength(fraction * getTotalLength())` on the rendered path, mapped to the
  window by `getScreenCTM()`. It is exact for a curve, it costs the test nothing, and it
  measures the thing the requirement is about.
- **A fixture that measures the board must not contain a hand.** The loops in
  `tests/e2e/helpers/stroke.ts` wobble by 6 % of the radius with a wavelength of about
  three points, which is what a hand does - and which a smoothing curve is entitled to
  round away, so the painted box comes out a few pixels inside the dragged one at any zoom.
  `loopPath` grew a `wander` argument for exactly this: `wander = 0` for the test that
  compares ink with mouse at 200 %, wobble left in for the ones that only need a drawing
  that looks drawn. A zigzag is fine for "did it survive a resize" and useless for "is the
  ink where the mouse went".
- **Padding lives in the stored box, so nothing downstream has to know about it.** A
  stroke's `x`/`y`/`width`/`height` are the trail's extremes grown by half a pen, which is
  what lets story 7 move, marquee, restack, resize, delete and undo a drawing with the code
  it already had; `objectBounds` has no special case, and `StrokeObject` positions itself
  with the four stored numbers. The trail is stored *relative to that grown box* and
  `baseWidth`/`baseHeight` remember the size it was drawn at, so a resize is two numbers
  and `scaledPoints` is the whole of `pen.resize`. The one cost is that every test that
  compares a box with a mouse has to remember which of the two boxes it is holding: the
  stored one is bigger than the ink by half a pen on all four sides.
- **The simplifier's tolerance is a screen distance, and that is one function.**
  `simplifyToleranceAt(zoom)` in `simplify.ts` is `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, and
  the reason it is a function rather than a division in three places is that a tolerance
  divided by the zoom in one call site and not in another is a pen that draws a different
  line at 400 % depending on which gesture ended it. The unit test says why: at 200 % the
  tolerance is half a board unit, so the same drag keeps four times the points and looks
  the same at both zooms.
- **The pen is the first tool that stays in the hand.** The other three drawing tools call
  `onCreated` - select the new object, go back to Select - and the pen calls nothing,
  because a person who has drawn one line is drawing several (`pen.stay_active`). It is the
  reason the tool has no `onCreated` prop at all rather than an unused one, and the reason
  the ink and the width are `usePenOptions` session state beside the tool and the
  selection: not in the document (a colleague choosing red changes nothing here) and not in
  local storage either (the PRD asks for defaults on every load, and a pen left down
  yesterday was not chosen for today's meeting).
- **The pen's layer is *inside* the viewport, and the other tools' surfaces are beside it.**
  `BoardViewport` grew an `overlay` prop rendered after `.board-world`, and its
  `handlePointerDown` refuses to pan or marquee whenever an overlay is up - the same answer
  the tool surfaces give, given where the pan would start rather than wherever a tool
  remembers to cooperate. A sibling element would catch the strokes and lose the wheel,
  because the wheel is listened for on the viewport element and only a child bubbles to it;
  `pen.navigation` ("the board still pans and zooms while the pen is up") is the
  requirement that decides the DOM.
- **jsdom has no coalesced events and no geometry, so the story is split by that line.**
  Component tests fake `getCoalescedEvents()` on a native `PointerEvent` and the fake returns
  `{clientX, clientY}` - the properties the tool reads - because jsdom implements neither
  `PointerEvent.getCoalescedEvents` nor the `Point` interface. jsdom also does no painting,
  which is why `pen.smooth` at the *pixel* level and `pen.select` at the *pixel* level are
  e2e, and the component file settles for "how many points does the preview path hold" and
  "does a press on the hit path reach the gesture handler". The preview is scheduled on one
  `requestAnimationFrame` per frame with a *token* rather than a handle: jsdom's
  `cancelAnimationFrame` is a no-op and a browser may deliver a frame that was cancelled a
  moment ago, so the callback asks whether it is still the one that was asked for.
- **Timing that only shows up in the browser:** `page.mouse.move` is a round trip of some
  70 ms here, so a 116-point loop takes eight seconds of wall clock and the golden path -
  three contexts, two drawings, a resize, a delete, and `measureChange` polling on three
  screens - needs `test.setTimeout(150_000)`. It is not a slow test; it is a minute of mouse
  events, which is what the story is.
- **A killed e2e run leaves a server behind, and the next run does not say so.** The suite's
  `webServer` starts `wrangler dev` on `AGENT_PORT_FIRST + 4` (24216 here) with
  `reuseExistingServer`, and this sandbox cannot signal a `wrangler dev` - `pkill`/`pgrep`
  answer "Cannot get process list", and the port map above already has 24210/24211 and
  24216/24217 held that way. Interrupt a run (a timeout, a Ctrl-C) and its server keeps the
  port; the next run's `wrangler dev` moves to a free port of its own, while `tests/e2e/target.ts`
  still points the pages at 24216 - so the pages talk to the *orphan*, which is serving the
  build that was current when it was started. The failure is not a connection refused: it is
  every test of every later file failing in about five seconds on `zoom-label` never
  appearing, because the orphan's build is not the build under test. The same collapse comes
  from running story 9's TC-24 in the same invocation as other files: it calls
  `startWrangler({ port: PORT })` - the *suite's own port* - and takes it whenever the suite's
  server is not sitting on it, which is what it is asked to do and what its own comment
  (24214/24215) does not say; then it `stop()`s that server on its way out, and every test
  after it has nothing to talk to. The log line to look for is `[e2e] starting wrangler dev on
  http://127.0.0.1:24216` in a run whose own server had already moved elsewhere.
  Both are avoided by giving the run a port pair of its own -
  `E2E_PORT=24220 E2E_INSPECTOR_PORT=24221 npx playwright test ...` - which is how story 11's
  tests were verified: 22 pen tests on both Chromium projects, plus 165 tests over the ten
  other spec files, with 24216 held by an orphan that nothing in this story started.
