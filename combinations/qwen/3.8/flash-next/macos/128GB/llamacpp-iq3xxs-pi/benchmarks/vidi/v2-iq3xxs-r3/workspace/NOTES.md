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
  (`zoom.no_page_zoom`) is scoped to gestures *over the board*, and TC-30 asks
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
  it. `decodeMessage` therefore hands back a view *including* the body's own
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
  `npm run build`/`build:test` the running server still serves the *old*
  `index.html`, whose hashed asset no longer exists, and the SPA fallback answers
  `/assets/index-<old>.js` with HTML → "Failed to load module script: Expected a
  JavaScript-or-Wasm module script but the server responded with a MIME type of
  text/html" and a blank board. Restart the server after every build (Playwright's
  `webServer` does that for free, which is why the e2e task starts the server
  itself instead of reusing a hand-started one).

## Story 3: client connection notes (task 4)
- `y-websocket@3`'s provider sets `synced = false` on every close *before* it
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
  tabs of one browser sync *around* the server, and TC-22 would pass on a
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
- `role="status"` is *not* unique to the badge: story 1's zoom percent is an
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
`tests/integration/ws-client.ts` is a *test* client that speaks the wire
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
  needs the room to pass an error handler that *rethrows*
  (`src/worker/board-room.ts`); without it the room logs and relays as if nothing
  happened. Unknown *frame* types and unknown *sync* types already throw out of
  `readSyncMessage` on their own.
- **`evictAllDurableObjects()` waits for the object to become idle**, and a room
  with a socket still open never does — one leaked socket anywhere in the file
  (which is what a failing test leaves behind) turns the restart test (TC-18)
  into a 30 s timeout. `abortAllDurableObjects()` is the honest tool for TC-18
  anyway: it is a restart, not a graceful eviction, and both take no namespace
  argument ("all" means all).
- `setStickyColor` rejects colour names outside the palette *silently* (no
  transaction), so a test that asks for `'purple'` waits forever instead of
  failing loudly. `recolourNote` in the helper is typed
  `StickyColor`/`STICKY_COLOR_NAMES` for that reason. The palette is yellow,
  orange, green, blue, pink, violet — six, not four (the "four colours" wording
  in some spec prose predates story 1's palette; the model is the source).
- `synced()`/`closed()`/`waitFor()` in the helper time out after 3 s and the
  integration project's `testTimeout` is 60 s, so a stall reports *its own*
  message (including the frame counters) instead of vitest's generic "Test
  timed out". `console.log` does reach the reporter under
  `--reporter=verbose`, which is where the TC-12 seed and per-client op counts
  are printed.
- TC-04 asserts `listDurableObjectIds(env.BOARD_ROOM)` is empty — a bad id did
  not merely fail to answer, no room object was ever instantiated. It has to be
  the first test in `worker.test.ts`: objects live for the whole file.
- TC-13 is written as `MAX_CONCURRENT_EDITORS + 1` clients around one board and
  asserts the last one's note reaches all the others *and* that they all hold the
  same position — nobody is turned away, and nobody is second-class.
