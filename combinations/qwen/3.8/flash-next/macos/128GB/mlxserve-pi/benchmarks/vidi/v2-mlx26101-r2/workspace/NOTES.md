# NOTES

Environment notes and deviations from the story's test strategy on this machine.

## Ports

Every server listens inside `$AGENT_PORT_FIRST`..`$AGENT_PORT_LAST` (24208–24223 here).

| Port | Use |
|---|---|
| 24208 (`AGENT_PORT_FIRST`) | `npm run dev` (Vite dev server) |
| 24212 (`AGENT_PORT_FIRST + 4`) | e2e server: `wrangler dev` statically serving `dist/client` (test build) |
| 24213 | the `wrangler dev` inspector port that goes with 24212 |

`wrangler dev` is started with `--ip 127.0.0.1 --port 24212 --inspector-port 24213`,
and the Vite dev server is pinned to `host: '127.0.0.1'` (with the default it
binds `::1` here and `http://127.0.0.1:24208` refuses connections).
Ports 24210/24211 are held by a `wrangler dev` process that this sandbox cannot
signal (`kill` is refused), so the e2e port is `AGENT_PORT_FIRST + 4` rather than
`+ 2`; the port stays configurable through `E2E_PORT` / `E2E_INSPECTOR_PORT`.

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

## Deviations

- None from the story's acceptance criteria. The e2e port differs (see Ports),
  Safari pinch gestures are not covered in e2e (see Browsers), which the story's
  test strategy explicitly allows, and Firefox/WebKit tests skip themselves on
  this machine because those browsers cannot be launched here (see Browsers) -
  story 1 and story 2 alike (68 e2e tests run, 68 skip themselves for that reason).
  The same is true of this story's TC-22 to TC-28: they are written browser-agnostic
  and run in chromium and chromium-retina here; the nightly capacity soak (TC-30) is
  chromium-only by design.
