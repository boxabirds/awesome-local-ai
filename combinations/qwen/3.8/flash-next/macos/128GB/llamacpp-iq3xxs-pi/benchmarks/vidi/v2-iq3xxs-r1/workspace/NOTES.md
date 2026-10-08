# Notes — decisions & deviations

## Story 1: Pan and zoom around an infinite board

### Stack / versions
- Vite 6 + React 19 + TypeScript client. Playwright pinned to the version whose
  bundled browser revisions match the machine cache (chromium-1243, firefox-1543,
  webkit-2359) so no browser download is needed. `PLAYWRIGHT_BROWSERS_PATH` is
  already exported in the environment.
- esbuild/workerd postinstall scripts are blocked by the sandbox's allow-scripts
  hook, but the platform binaries install via their optional
  `@esbuild/darwin-arm64` / `@cloudflare/workerd-darwin-*` deps, so Vite, Vitest
  and `wrangler dev` work without running those scripts.

### Ports (all inside $AGENT_PORT_FIRST..LAST = 25232..25247)
- `wrangler dev` app: 25232; wrangler inspector: 25233.
- Vite dev server: 25234; Vite preview: 25235 (strictPort).

### Architecture decision — sharing camera state (design contract tension)
The design lists `useCamera(viewport)`, `BoardViewport({ children })`,
`ZoomControls({props})` and `NavigationHint({ visible })` as separate exported
interfaces, and says App wires them together. To keep `BoardViewport`'s public
prop shape to just `{ children }` (so the world layer can later hold object
children transformed with the camera, while the fixed-position controls must
live outside the CSS transform), the camera state is provided to the component
tree through a small React context (`BoardCameraProvider` + `useBoardCamera`)
that owns `useCamera` and the `ResizeObserver`-measured viewport `Size`. This is
an addition to `useCamera.ts` exports, not a change to any listed signature.
- `BoardViewport` reads the context and attaches the measured viewport ref.
- `App.tsx` renders connector components that read the context and pass the exact
  props the design specifies to `ZoomControls` / `NavigationHint`.

### Grid background-position modulo
Design text writes `background-position = -x*zoom mod spacing`; the correct value
is `mod (spacing*zoom)` (they coincide at zoom = 1). Implemented as
`-x*zoom mod (GRID_SPACING_WORLD*zoom)` so the dot spacing on screen always equals
`GRID_SPACING_WORLD*zoom` at any zoom. Noted in NOTES only; not a behaviour change.

### Test-only hooks
`window.__vidi6 = { setCamera, getCamera }` is installed only when
`import.meta.env.MODE === 'test'`. `npm run build:test` (`vite build --mode test`)
produces the client served to Playwright so the hooks exist in e2e. `npm run build`
(production) omits them. `getCamera` was added (in addition to the design's
`setCamera`) so component/e2e tests can assert camera state without parsing CSS
matrix transforms.

### rAF batching in tests
Camera commits are coalesced with `requestAnimationFrame`. Component tests flush a
frame deterministically with `await act(async () => { await new Promise(r =>
requestAnimationFrame(r)) })` (real rAF from jsdom) rather than fake timers —
simpler and still deterministic.

## Implementation refinements (tasks 3-7)

### All viewport input uses native `addEventListener`, not React `on*` props
pointer / wheel / gesture / keyboard handlers are attached in a single effect via
`addEventListener` (`wheel` with `{ passive: false }` so `preventDefault` can stop
native page zoom). React's synthetic `onPointerDown` handlers did **not** fire
reliably under jsdom, and native listeners give one consistent path for real
browsers and jsdom tests.

### jsdom has no `PointerEvent` constructor
Component pointer-drag tests dispatch a plain cancelable `Event('pointerdown'|…)`
and assign the fields the handlers read (`button`, `pointerId`, `clientX`,
`clientY`) — helper `dispatchPointer` in `tests/component/util.ts`. The production
code still uses real `PointerEvent`/`setPointerCapture` in the browser.

### wrangler assets-only config
`wrangler dev` for a static-assets-only Worker **rejects** an `assets.binding`
(`Cannot use assets with a binding in an assets-only Worker`), so `binding: "ASSETS"`
was removed from `wrangler.jsonc`. `main` stays `worker/src/index.ts` (added in
story 3). Serving works: `wrangler dev --ip 127.0.0.1 --port 25232
--inspector-port 25233` returns the SPA (200) and its hashed JS assets.

### E2E page-zoom assertions
Playwright cannot hold a keyboard modifier while synthesising a real wheel across
browsers, and OS/browser-level zoom is not observable in headless, so TC-24/TC-31
dispatch a cancelable `WheelEvent` with `ctrlKey:true` at a client point (exercises
the handler under real CSS layout) and assert `window.visualViewport.scale === 1`
and unchanged `devicePixelRatio` as the "page not zoomed" signal. TC-15/16/17/18
(component) already assert `event.defaultPrevented` directly.

### Browser engines — Firefox & WebKit could NOT be launched in this environment
All three Playwright projects are configured (`chromium`, `firefox`, `webkit`,
each pinned to a 1280×800 viewport at `deviceScaleFactor: 1`). On this host
(macOS 26.4, build 25E246, Playwright 1.63.0) the Chromium project runs green
(7/7). The cached **Firefox** and **WebKit** binaries abort immediately on launch
— this is an environment limitation, not a skipped/disabled test:

- Firefox: `…/firefox-1543/.../MacOS/firefox -headless …` → `<process did exit:
  signal=SIGABRT>` (`Abort trap: 6`).
- WebKit: `…/webkit-2359/pw_run.sh …` → `Abort trap: 6` (exit code 134).

Both were re-fetched via `playwright install firefox webkit` (no change). The
engines were not removed or excluded from the config, so `npm run test:e2e` still
attempts all three; only Chromium executes successfully here.

**Suggested next steps** (to actually run Firefox/WebKit): use a host OS supported
by Playwright 1.63's Firefox/WebKit builds (e.g. a GA macOS release or a supported
Linux distro) and run `playwright install --with-deps`, or bump/downgrade
Playwright to a build whose WebKit/Firefox are compatible with macOS 26.4. No
sudo/system changes were attempted (the task forbids installing packages).

## Verification gotcha (this sandbox)
`pgrep`/`pkill` do not work here (”sysmon request failed… Cannot get process
list”), so leftover `wrangler` servers cannot be killed that way. Because the
Playwright `webServer` uses `reuseExistingServer`, running `npm run build`
(production, no test hook) just before the e2e could leave a reused server serving
a hook-less bundle, making every e2e time out waiting for `window.__vidi6`. Make
sure the allocated ports (25232/25233) are free (”lsof -nP -iTCP:<port>
-sTCP:LISTEN -t -> kill -9”) and run e2e against a freshly built **test** bundle.
With that, `playwright test --project=chromium` is green (7/7).

---

## Story 2: Capture ideas on sticky notes and rearrange them

### Real-browser bug found by e2e: window-level drag tracking (no pointer capture)
`StickyNote` originally called `el.setPointerCapture(pointerId)` on `pointerdown`
and handled `pointermove`/`pointerup`/`lostpointercapture` on the note element.
Every jsdom test passed, but in Chromium **no note ever moved**: at drag start
`bringToFront` re-orders the notes array, React re-parents the note's DOM element,
and re-parenting *drops the pointer capture* → `lostpointercapture` fired → the
`pointercancel` handler ended the drag before the first `requestAnimationFrame`
move was applied. Now `pointerdown` attaches `pointermove`/`pointerup`/
`pointercancel` on `window` (removed in `finish`/effect cleanup) and no capture is
taken. This is also more correct in general: the pointer can leave the note while
dragging. Regression coverage: component test "drags the bottom note of an
overlapping pair and raises it above the other" plus e2e TC-32.

### `NoteToolbar` keeps a constant screen size inside the world layer
The design says the note toolbar is rendered above the selected note in screen
space and must not scale with zoom. It is rendered as a child of the note
(world-space coordinates) inside a `.note-toolbar-anchor` with
`transform: scale(1/zoom)` and `transform-origin: 0 0`, so it sticks to the note's
top-centre while its buttons stay pixel-constant (asserted in e2e: swatch width is
identical at 100% and 200% while the note doubles).

### Font fit: pure search + element wrapper
`fitTextFontSize(text, measure, boxPx)` is the pure, unit-testable search (a
monotone height oracle is passed in); `fitFontSize(el, boxPx)` keeps the design's
contract signature, measures through a hidden clone of the element and writes
`el.style.fontSize`. jsdom has no layout, so the fit is covered (a) in unit tests
with a stub measure, (b) in component tests via the same stub, and (c) for real in
e2e TC-33 (`getComputedStyle` font-size, `scrollHeight` vs container height,
`overflow` class and the bottom fade element). Zoom never changes which size fits
(the whole note scales), so the fit is memoised on `note.text` only.

### Sticky note creation point
`createSticky(doc, {x, y})` takes the **centre** and stores the top-left
(`x - STICKY_SIZE_WORLD/2`), which is what makes "centred on the double-click
point" and "created in the centre of the current view" both fall out of
`screenToWorld(viewport, size, camera)`.

### Selection lifecycle
`select(id)` also clears `editingId`; `startEdit(id)` sets both. When the selected
note disappears from the snapshot (deleted by another client — TC-37), an effect in
`App` clears the selection, so no dangling selection/toolbar can survive. A
deletion during a drag ends the drag silently because `moveObject` returns false
for an unknown id.

### Test-hook additions (test mode only)
`window.__vidi6` gained `getSnapshot`, `getSelection`, `getDoc` (model-level
deletion for TC-37) on top of story 1's `getCamera`/`setCamera`. `getDoc` exposes
the live `Y.Doc` so tests can act as a second client without any UI.

### e2e helpers worth knowing
- `setZoom` / `panFar` drive the camera through the hook; because the React
  re-render is asynchronous, both end with `waitForRender`, which polls until the
  world layer's `DOMMatrix` matches the camera in the model. Without it, screen-box
  measurements taken right after a camera change are stale (this caused two
  misleading failures before it was added).
- `noteAtPoint` uses `document.elementFromPoint` + `closest('[data-note-id]')`, so
  "drawn above the note it overlaps" (TC-32) is asserted by real paint order, not
  by DOM order.
- `STICKY_COLORS` is a `Record<StickyColor, string>`, so tests enumerate colours
  with `Object.keys(STICKY_COLORS)`.
- The overflow counter renders as `"<length>/1000"` (e.g. `995/1000`) only while
  within `STICKY_COUNTER_THRESHOLD_CHARS` (50) of the limit.
- The fade gradient uses 8-digit hex (`${color}00` → `${color}`) to go from
  transparent to the note colour without knowing the colour's alpha.

### Verification (this machine)
- `npm run build` ✓, `npm run typecheck` ✓ (covers src + all test dirs).
- `npm run test:unit` → 49 passed (camera 13 from story 1; board model 17;
  sticky text 19 incl. the font-fit search).
- `npm run test:component` → 39 passed (story 1: 14; story 2: 25 — StickyNote 15,
  StickyTextEditor 5, Toolbars 5).
- `npx playwright test --project=chromium` → 14 passed (story 1: 7, story 2: 7).
  The `firefox` and `webkit` projects are still configured but abort on launch on
  this host, exactly as recorded for story 1; story 2 adds no new engine issues.

---

## Story 3: See other people's edits appear live on the same board

### Where the room lives, and how to reach it
- The Worker route is `/api/rooms/:boardId`; `src/worker/index.ts` answers `426 Upgrade Required`
  when the id is valid but there is no `Upgrade: websocket`, `400` for a malformed id, and falls
  through to the assets binding otherwise.
- `y-websocket` builds its URL as `serverUrl + '/' + roomname + '?...'`, so `connectBoard` passes
  `serverUrl = ws(s)://<host>/api/rooms` and the board id as the room name. Nothing else in the
  client hardcodes the path.
- In a Durable Object response the client half of the pair is `response.webSocket` (there is no
  `webSocketPair`); the caller must call `ws.accept()` before reading or sending.
- `vite.base` must stay `'/'`. With `'./'` a deep link like `/b/<id>` resolves `./assets/x.js` to
  `/b/assets/x.js`, which hits the SPA fallback and dies as "Failed to load module script … MIME
  type text/html".

### Test infra gotchas (both cost real time before they were understood)
- **A reused `wrangler dev` can serve a stale asset manifest.** After a rebuild the old process
  still answers `/assets/index-<old>.js` from the SPA fallback, and the browser fails the module
  load. The orphan server on 25232 cannot be killed from this sandbox, so the Playwright config
  reads `VIDI6_PORT` / `VIDI6_INSPECTOR_PORT` (defaults 25232 / 25233, both inside the allowed
  range). A reliable local run is therefore e.g.
  `VIDI6_PORT=25244 VIDI6_INSPECTOR_PORT=25245 npx playwright test --project nightly` (avoiding
  25234, which is the vite dev server's own port), where
  Playwright starts its own server and builds first.
- `tests/e2e/helpers/sync.ts` waits for the board with an explicit 15 s `BOOT_TIMEOUT_MS`. Without
  it a broken bundle/server burns the whole test budget in default-timeout waits and the failure
  message is a mystery; with it the run fails where it should.
- `vitest-pool-workers` needs `isolatedStorage: false`, so integration tests isolate with *unique
  board ids* rather than fresh storage.

### Forcing a real disconnect
`context.setOffline(true)` does not close an already-open WebSocket, so it cannot stand in for a
dropped connection. The connection exposes test seams `dropConnection()` / `resumeConnection()`
(which call `provider.disconnect()` / `connect()` — y-websocket keeps `shouldConnect=false` after
`disconnect()`, so it really stays down) and `getConnectionState()`, patched into `window.__vidi6`
in test mode only.

### Awareness
The room relays awareness and ignores echoes (a stale clock is dropped by
`applyAwarenessUpdate`), and the periodic awareness renewal is what keeps `wsLastMessageReceived`
fresh — nightly TC-29 asserts the room keeps talking to an idle screen (received frame count
grows while nothing is typed).

`provider.awareness.getStates()` is **empty** on every client, because nothing in the app sets a
local awareness field. So "who is still in this room" is not observable from a client, and a
`getPeerCount()` test hook would always report 0; it was removed again. The nightly teardown check
instead watches the screen that survives the others closing: same number of sockets as before, no
badge, still `connected`, and its next edit still reaches the room.

### Caret behaviour under concurrent typing
`applyRemoteDelta` shifts the local caret for remote inserts and deletes
(`shiftForInsert` / `shiftForDelete`); the boundary case is "an insert at exactly the caret keeps
the caret *before* the inserted text". Pure remote inserts never move the caret backwards, which is
what the e2e caret check asserts after placing the caret with a **click**.

Worth knowing: while both screens were typing, a remote *replace* (the other editor's textarea
flush diffing out a delete followed by an insert on the far side of the caret) was observed to
leave the caret a few characters earlier than the user had put it, once in a while. Not chased; a
candidate for a follow-up if caret fidelity during heavy shared editing becomes a story.

### Nightly project
`npm run test:e2e:nightly` builds in test mode and runs `--project nightly` (specs tagged
`@nightly` under `tests/e2e-nightly/`); `npm run test:e2e` greps them out. The nightly project has
a 10 minute per-test timeout because a 45 s idle window and a 60 s soak are the tests themselves.
TC-30 runs `MAX_CONCURRENT_EDITORS` (5) screens for 60 s of seeded random UI edits (create, type,
move, recolour, delete; seed printed in the report), measures the delay of every create/type change
to the slowest other screen, and prints p50/p95/max against `LIVE_UPDATE_LATENCY_BUDGET_MS` —
reported, never asserted. Convergence *is* asserted: per measured change, and again by comparing
the final `getSnapshot()` of every screen. Spots for new notes must sit further apart than
`STICKY_SIZE_WORLD` (200) or the double-click opens an existing note instead of creating one.

### Verification (this machine, story 3 final state)
- `npm run typecheck` ✓ (src + all test dirs, incl. `tests/e2e-nightly`).
- `npm run test:unit` → 71 passed (board model 17, camera 13, sticky text 19 + `applyRemoteDelta`,
  board id, protocol, board route).
- `npm run test:component` → 45 passed (story 2's 39 + ConnectionStatus 6).
- `npm run test:integration` → 27 passed in workerd (10 Worker routing, 17 BoardRoom); 10
  consecutive clean runs while writing them, no flakes.
- `npm run test:e2e` → 25 passed (story 2's 14 + story 3's 11) against a freshly built server.
- `npm run test:e2e:nightly` → 2 passed in ~1:55: TC-29 idle (stayed `connected:0` for 45 s, edit
  after the quiet landed in 18 ms), TC-30 soak (83 ops, 49 measured changes, p50 26 ms /
  p95 98 ms / max 200 ms, all converged).
- Firefox/WebKit still cannot launch here (see story 1 note). `VIDI6_BROWSERS` defaults to
  `chromium`; `VIDI6_BROWSERS=chromium,firefox,webkit` restores the full matrix, including the
  `nightly-firefox` / `nightly-webkit` projects.

## Story 4 — Return to a board and find everything as it was left

### Storage layout (BoardStore)
`updates` is an append-only log of every Yjs update (one BLOB row each), `snapshot_chunks`
holds a `Y.encodeStateAsUpdate` of the document split into `SNAPSHOT_CHUNK_BYTES` rows, and
`storage_meta.snapshot_through_seq` records the log `seq` the snapshot already covers, so a
later load replays only `seq > through`. A damaged *log row* is quarantined and skipped
(the rest of the board loads, TC-09/TC-09-style partial damage); a damaged *snapshot* is
fatal — `load` returns `{ok:false, reason:'snapshot-unreadable'}` and deletes/quarantines
nothing, so a retry sees the same bytes (TC-10). Compaction writes the new snapshot and only
then trims log rows `seq <= through`; if it throws mid-way the whole thing is in one
`this.exec` transaction so it rolls back (TC-11).

### load_failed vs storage_failed, and the close codes
`failLoad` maps **any** load failure (unreadable snapshot *or* a SQL read error) to
`status:'load-failed'` + close `4500`, throttled to one reload per `LOAD_RETRY_MIN_INTERVAL_MS`
(TC-26). `4500` is deliberately *outside* y-websocket's permanent range (4400–4499), so the
provider keeps retrying on its own and a repaired board recovers with no reload (TC-24).
`1011 storage-failed` is reserved for a **write** (append) failure while connected — a board we
cannot write must not keep being served — and simply reloads on the next connection. `1003`
closes only the one socket that sent an undecodable update; the room and other sockets carry on.

### Client side
`canEdit(state)` is false **only** for `load_failed`; every other state (`connecting`,
`connected`, `reconnecting`, `confirmed`) keeps the board editable, so a reconnection never
locks the board (TC-28). `App` passes `editable` down to `StickyNote`/`NoteToolbar`, which make
drag, double-click-to-edit, colour and delete inert while locked, so "editing it would only
produce changes that cannot be saved" cannot happen (TC-23).

### E2E persistence (TC-19, TC-20, TC-21) and the wrangler harness
These live in their own Playwright project (`playwright.persist.config.ts`,
`npm run test:e2e:persist`) because they drive `wrangler dev --persist-to <dir>` themselves and
must kill it and start another one over the same on-disk SQLite — that *is* "the Worker
restarted". They use their own ports 25240/25241 (still inside the allowed 25232–25247) and run
serially. `seedBoard(n)` on the test hook fills a board through the normal create path so it
syncs and is stored like any real edit. TC-19 asserts the reopened board is byte-identical;
TC-20 proves the store-before-broadcast guarantee by leaving within a second of the note
appearing; TC-21 logs load timings (budget never asserted).

**Large-board caveat (the one thing not proven end-to-end in a browser here).** TC-21 seeds the
full `PERSIST_TESTED_NOTES` (2000) board, restarts, and proves it loads back out of storage —
measured ~18 ms server-side — but it does **not** drive all 2000 notes back *through the browser*.
Past a few hundred notes the client, running on the same CPU as the server it must sync with,
cannot finish applying + rendering 2000 note components inside its sync window, so it never
settles ("Reconnecting…" forever, snapshot 0); this is a client-render limit, not a storage one,
and virtualisation is out of scope for this story. So TC-21 runs the full reopen-restore cycle
in the browser at a renderable size (200 notes) and proves the full 2000-note size survives a
restart server-side via the load hook. Everything storage-related about a 2000-note board is
covered; the 2000-note *render* within `BOARD_LOAD_BUDGET_MS` is not asserted.

### Test-only storage damage hooks (TC-24) and the warm-room trap
`src/worker/index.ts` registers `/__test/boards/:id/{corrupt-snapshot,repair-snapshot,board-summary}`
only when `env.TEST_HOOKS === '1'`, which only the e2e-persist wrangler sets (`--var
TEST_HOOKS:1`); the production config never sets it, so those paths fall through to the SPA. The
hooks are RPC methods on `BoardRoom` that drive the same SQLite: `corrupt-snapshot` folds the
board into a real snapshot through the same chunking code, then overwrites chunk 0 with random
bytes (a deterministic scramble was not enough — Yjs tolerates it; only genuinely malformed bytes
make `load` return `snapshot-unreadable`). A client that opens such a board gets the honest red
load failure with editing locked, never an empty board.

**Why TC-24 restarts the Worker mid-scenario:** a board whose last socket closed keeps its
in-memory `Y.Doc` (it hibernates, it does not drop the doc), so a soft disconnect/reconnect or a
page reload lets a *warm* room serve its in-memory copy and skip the damaged snapshot entirely —
the client even re-pushes its notes into the log. Only a fresh Worker process forces a re-read of
the damaged snapshot, so TC-24 corrupts, restarts, and lets a fresh client discover the damage.
Recovery (repair, then auto-retry past the throttle) is then proven on that same never-reloaded
page, guarded by a `window` marker that could not survive a reload.

### Verification (this machine, story 4 final state)
- `npm run typecheck` ✓. `npm run build` ✓ (prod) and `build:test` ✓ (test-mode client for e2e).
- `npm run test:unit` → 110 passed. `npm run test:component` → 49 passed (added load-failure
  badge/lock/close-code tests). `npm run test:integration` → 45 passed (added 10 BoardStore +
  8 persistent-room persistence tests).
- `npm run test:e2e` → 25 passed (story 2/3 unchanged; new gated worker routes are inert without
  `TEST_HOOKS`). `npm run test:e2e:persist` → 4 passed (TC-19/20/21/24) against real process
  restarts; run several times clean, no flakes.

---

## Story 5 — Share a board with others using a link

### Existence is a storage fact, not a flag we hope was written
`BoardStore.existsReadOnly()` reads, in order: `sqlite_master` for the board's own tables
(no tables → the board cannot exist, and *nothing is created* while finding that out), then
`created_at` in `storage_meta`, then the presence of any row in `updates` /
`snapshot_chunks`. The second test is what makes **legacy boards** (stored before this
story) count as existing, and it is why `migrate()` no longer runs from `bootstrap()` or
`loadIntoFreshDoc()`: if a probe created tables, every mistyped link would leave storage
behind (TC-09 asserts the table list stays empty after probing). `migrate()` now runs from
`initialize()` (creation) and lazily once before the first `append()` — a board is
created by its first write, never by someone asking whether it exists.

### 404 before the socket is accepted
`BoardRoom.fetch()` asks `exists()` **before** `acceptWebSocket`, so a websocket upgrade to
an unknown board is answered 404 and never becomes a room. A room that exists but is asleep
is woken for the check and then serves; the check itself reads two indexed queries, not the
board's content — "does this board exist" must never hand back a stranger's notes.
Malformed ids are rejected by shape in `index.ts` (never reaching `idFromName`), and the
room route now answers **404** where story 3 answered 400: the difference matters because
the client turns 404 into the Board not found page.

### No page creates a board id
`newBoardId()` is imported by the Worker, the fixtures and the tests — never by `src/client`
(TC-18 asserts that every address a home→board→share run uses carries the id that came back
in the one `POST /api/boards`). `Board` takes `boardId: string` as a required prop; story 3's
`boardRoute.ts` (`/` → random id) is deleted, and `main.tsx` no longer rewrites the URL.
That is why every e2e helper that wanted "a board of my own" (`gotoBoard`, `gotoNewBoard`,
`openScreen(page, '/')`) now clicks `New board` instead of being handed one.

### Two-second confirmation, and what the button "says"
The copied state resets when the panel closes: a panel that remembered "Link copied" would
be making a claim about a copy that person did not just do. In the DOM the confirmation is
`<span aria-hidden="true">✓</span> Link copied`, so the *accessible name* is exactly
`Link copied` while `textContent` is not — component tests assert
`getByRole('button', { name })` (what a screen reader hears) and check the tick separately.

### Clipboard: two doors, and both have to be closed to test the fallback
`copyToClipboard` tries `navigator.clipboard.writeText`, and on any failure falls back to
selecting the input and `document.execCommand('copy')`. In jsdom the second door does not
exist (TC-23/TC-24 get the manual message). In a real browser `execCommand('copy')` on a
selected input **succeeds**, so an e2e that only rejects `writeText` legitimately ends up
with the link copied — to test the manual path for real, an init script must refuse *both*
(`writeText` rejects and `document.execCommand` returns false). The stub keeps a real
`readText`, which is what lets TC-29 finish by pressing the person's own copy shortcut and
reading the link back out of the browser.

Reading the clipboard in e2e needs `context.grantPermissions(['clipboard-read',
'clipboard-write'])`, and the copy + read must happen on the focused page.

### Probing a link: `/b/...` always answers 200
`not_found_handling: single-page-application` means `GET /b/<anything>` returns the app
shell with 200. Only `/api/boards/:id` can say whether a *board* is there, so the e2e
"nothing was created by visiting this link" check (`probeBoard`) goes to the API path.

### e2e details found the hard way
- `boardLink(window.location.origin, boardId)` builds the panel's address rather than
  reading `window.location.href`, so a stray query or hash on the page cannot leak into a
  shared link. TC-26 asserts panel text === clipboard text === address bar anyway.
- `page.evaluate(() => fetch('/api/boards'))` fails with "Failed to parse URL" when the page
  is still `about:blank`; server-side fixtures use Playwright's `request` fixture (it knows
  `baseURL`) instead of a page.
- The unreachable board page shows the PRD message *and* a `Retrying in Ns.` line, so an
  exact-text assertion on the container fails; assert the `role=status` child for the copy
  and `.page-note` for the countdown.
- `page.route('**/api/boards/*', abort)` + `unroute` gives a service that comes back on its
  own; a `window.__tc28` marker set before the retry proves the board appeared in the *same*
  document, i.e. without a reload.
- TC-26's click-to-board number is **logged** against `CREATE_BUDGET_MS`, never asserted
  (design: a shared machine that takes longer is not a broken board). This run: ~190-260 ms.

### Test hooks: the base e2e project now needs `--var TEST_HOOKS:1`
`seed-legacy` (in `src/worker/test-hooks.ts`) exists so TC-31 can open a board that was
never created through the API. `playwright.config.ts` therefore starts `wrangler dev` with
`--var TEST_HOOKS:1` like the persist project already did; the production config never sets
it, so `/__test/...` falls through to the SPA there. `seedLegacyBoard()` deliberately does
**not** call `POST /api/boards` first: it hands the hook an id and lets the room write update
rows with no `created_at`, which is the exact shape the existence check must forgive.

### Verification (this machine, story 5 final state)
- `npm run typecheck` ✓ (src + all test dirs). `npm run build` ✓ and `npm run build:test` ✓.
- `npm run test:unit` → 115 passed (adds `create-board` unit tests + TC-04 id strength).
- `npm run test:component` → 64 passed (story 5 adds `pages.test.tsx` 9 and
  `share-panel.test.tsx` 6, plus the migration of every story 2/3 component test from
  `<App>` to `<Board boardId>`).
- `npm run test:integration` → 60 passed in workerd (`board-api.test.ts` adds TC-05…TC-10,
  TC-12, TC-14, TC-15, TC-32; story 3's routing/room tests were re-pointed at the new API).
- `npx playwright test --grep-invert @nightly` → 30 passed (story 1/2/3 suites still green
  after the helper changes, plus the 5 new share tests). `npm run test:e2e:persist` → 4
  passed (now creating their boards over the API). `npm run test:e2e:nightly` → 2 passed.
- TC-27/TC-29 in Firefox and WebKit: **still not runnable here** — the cached Firefox and
  WebKit binaries abort on launch on this host (`SIGABRT` / exit 134), exactly as recorded
  for stories 1-4. Re-checked this story: `VIDI6_BROWSERS=chromium,firefox,webkit` gives a
  green chromium run and two launch failures, so those two cases are blocked by the
  environment, not by anything in the code.

## Story 8 — per-person undo over `Y.UndoManager` (yjs v13)

### What `Y.UndoManager` actually does (all of it verified against the installed version)
- `trackedOrigins: new Set([LOCAL_ORIGIN])` captures a transaction only when its origin
  is that exact value. Remote updates (provider origin) and story 4's load transaction
  therefore never enter the stacks — that one option is the whole of "my history only".
- **Nested transactions inherit the outer origin.** `doc.transact(fn)` inside a
  transaction whose origin is `LOCAL_ORIGIN` is captured too, whatever origin the inner
  call asks for. Fixtures that must be invisible to undo are written with
  `doc.transact(fn)` and *no* origin (null is not in `trackedOrigins`).
- `captureTimeout` merges consecutive *tracked* transactions into the last stack item.
  It is the **only** merging mechanism in v13 (v3's content-based merging of adjacent
  inserts does not exist here), which is why step boundaries are explicit: `stopCapturing()`
  sets `lastChange = 0`, so the next tracked transaction opens a new item even 1 ms later.
- Events are `stack-item-added` / `stack-item-popped` / `stack-cleared` /
  `stack-item-updated`; the stacks are readable (`m.undoStack`, `m.redoStack`) which is
  how `undo.limit` trims `undoStack[0]` on add.
- **`undo()` keeps popping until it finds an item with an effect.** When my move targets a
  note somebody else deleted, that item is consumed *and the item below it is reversed in
  the same call* (TC-07, TC-23). It never throws and never resurrects the note, but a
  test must not assume "one Ctrl+Z = one stack item" across a ghost step.
- Pan/zoom and selection live in local React state, not in the document, so they cannot
  enter the history at all — PRD "does not undo navigation or selection" comes for free.

### Fake timers and lib0
`lib0/time.js` does `export const getUnixTime = Date.now`, taking the function **by value**
when the module is evaluated. `vi.useFakeTimers()` after yjs has been imported changes
nothing for the capture timeout. The capture-timeout unit tests therefore install the fake
clock first and load yjs afterwards with `await import('yjs')` (+ `toFake: ['Date']`).

### user-event keyboard syntax
Holding a modifier while a key is pressed is `'{Control>}z{/Control}'`. `'{Control>z/}'`
is a parse error ("Expected repeat modifier") — `>` must be followed by a repeat count or
the closing bracket.

### Design file list vs. this codebase
- `src/client/App.tsx` is only the router here; the controller is created with the board
  document in `Board.tsx` and destroyed on unmount/board change — same lifetime the design
  asks for.
- `src/client/board/useTransformGesture.ts` is *not* modified: it already calls
  `onGestureStart`/`onGestureEnd` (story 7), and `Board.tsx` passes `undo.boundary` for
  both (pointercancel included). The hook is where the design wanted the call; the
  callback was already in its right place, so the wiring is one line in the caller.
- In `tests/e2e/undo.spec.ts` the seeding screen has extra history of its own (it created
  the fixture notes), so "this person has run out of steps" is only asserted for the
  screens that joined.

## Story 9 — free text: measuring, painting and syncing a box

### A box rounded down wraps its own line
The automatic width of a text is *the measured width of its longest line*, and the browser
wraps at exactly that stored width. Rounding the box with `Math.round(x*100)/100` can make
it a hair narrower than the glyphs it holds, and the browser then breaks the line: a
sentence that fits appears on two rows, with a height nobody asked for. The automatic width
is therefore rounded **up** (`Math.ceil(x*100)/100`); a width a person dragged to is still
stored exactly as dragged. jsdom cannot find this: its measurer is a character-count
estimate, which lands on round numbers, and only real fonts in a real browser wrap.

### Asking a canvas for a measurement is a side effect in a test environment
`document.createElement('canvas').getContext('2d')` is undefined in jsdom, so a measurer
falls back to an estimate — fine, but *when* it is asked matters. Building the canvas
measurer when a board mounts makes every unrelated test pay for it (and print warnings);
`sharedMeasurer()` in `textLayout.ts` builds it on the first actual measurement, so files
that never measure never ask.

### Two boards on one page
React 19 + RTL 16 can leave the previous test's board mounted while its effects are torn
down, so a `screen.getByTestId(...)` query or the `window.__vidi6` hook can belong to the
older board. In async component tests (the ones that `await` a frame) mount with a flushed
frame before and after `render` — a local `freshBoard()` in `TextObject.test.tsx` — and
assert on the fixture that this test created.

### Pressing keys in jsdom
`userEvent.keyboard` does not reliably reach React's synthetic `onKeyDown` when it is not
awaited, and even when it is, the frame it lands in is not the frame the assertion runs in.
Dispatching a `KeyboardEvent` on the focused element inside `act` (`pressKey` in
`tests/component/textUtil.ts`) is deterministic, and it is also how the *board* shortcut
tests in earlier stories worked.

### One frame is not always enough, under load
`flushFrame()` advances one `requestAnimationFrame`, which is normally where a
board-level change (an undo, a redo) shows up in React state. When 33 test files run in
parallel it can take a second one, and reading the board in that frame fails
intermittently. `flushUntil(predicate)` in `tests/component/util.ts` flushes until the
board says what the test expects and then lets the test assert the value it wanted; the
story 8 redo assertion that this showed up in uses it now.

### Concurrent typing converges; it does not order itself
Two screens typing into one `Y.Text` end up with identical documents (verified in the
browser: both screens show the same string after every pair of keystrokes). What is *not*
deterministic is the order the characters land in, because each caret sits where its owner
left it. So the test asserts the two screens agree and that the sorted characters of both
equal the sorted characters that were typed — never a fixed merged string.

### Reading the board immediately after the other screen typed
The last keystroke of a remote screen can still be in flight. `textById(a)` and
`textById(b)` read two documents that are *eventually* equal; an equality assertion right
after the final key is a race. Poll for agreement (`expect.poll`) rather than sleeping.

### Fixture arithmetic
`'a ' + 'b '.repeat(2)` repeats one fragment, not the fixture, and the assertion that the
fixture is long enough then fails for a reason that has nothing to do with the board. Build
fixtures with an array and `join`, and keep the length check on the thing that was typed.

### E2E serves a build, and reuses a server
`playwright.config.ts` builds `dist/client` and hands it to `wrangler dev`, with
`reuseExistingServer: !CI`. After changing client code, the server already listening on
25232 keeps serving the *old* build: kill it (`lsof -ti tcp:25232 | xargs kill`) before the
next run, or the suite tests yesterday's code and passes.

### A string I typed for a test was the wrong length
`page.keyboard.type(LONG_SENTENCE)` was fine; `LONG_SENTENCE` was 254 characters because of
operator precedence, and the test failed on "this fixture is over 300 characters". Compute
fixture lengths, don't eyeball them.

---

## Story 10 — shapes and connectors

### One tool mechanism, not two
`useTool` (story 9's Text tool) and story 10's needs are the same problem, so there is now
one hook, `src/client/board/useActiveTool.ts`, owning `tool`, the shape `kind`, `setTool`
and `toolCreated(id)` (select the new object, go back to Select). `useTool.ts` is deleted.
Shortcuts go through `useBoardKeys` with a generic `TOOL_SHORTCUTS` table (`v n t s l p i c`)
rather than per-tool key handlers; `n` stays "create a note directly" because that is what
story 2 shipped. A test that clicks a tool button and a test that press the key now exercise
the same state machine.

### `board-model.ts` and `objects/connector.ts` import each other
`deleteObjects`/`deleteObject` call `detachConnectorsTo`, and the connector module reads the
board's object map. The cycle is real but harmless: every use is inside a function body, and
ESM live bindings resolve it. It is the same shape as `board-model` already having
`objects/text.ts` reach back for `initDoc`-adjacent helpers. Worth knowing before adding a
top-level value (a constant used at module scope) to either module — that would break.

### A connector follows without being told to
A connector stores its ends (object id + fallback point) and a bounding box, but the box and
the drawn ends are re-derived from the current object rectangles on *every read*
(`connectorSnapshots`). Moving a shape therefore moves the arrow with no extra document
traffic and no repair pass. `resolveEndpointPair` picks, for each end, the side of the object
that faces the *other* end's centre, so an arrow that has been dragged past its partner
re-anchors on the opposite side without the model remembering any side explicitly.

### The main toolbar was under the new tool layers (found by e2e, not by jsdom)
The Shape/Connector tool layers are absolutely positioned over the whole viewport
(`z-index: 20`), and `.board-toolbar` had no `z-index` at all. In jsdom nothing hit-tests, so
the component tests clicked the shape-kind buttons happily; in a real browser the layer ate
the clicks and a user could not pick Diamond while the Shape tool was active. `.board-toolbar`
is now `z-index: 40`, in the band the other fixed panels use (badge 40, share 45). Another
example of a CSS stacking bug that only a real pointer can find.

### The top-left corner of the board belongs to the toolbar
`tasks.md` asks TC-23 to drag `(100,100) -> (300,220)`, but the toolbar panel occupies
x 16..149, y 16..433, so that drag starts on a button. The test drags `(400,120) -> (600,240)`
instead — the same 200x120 box, asserted to the pixel — because the interesting part of the
assertion is "the box is what the pointer described", not which corner of the screen it
started from.

### One measurable box for a shape label
`.shape-label` is a flex box centring an inline `<span>`, and an inline element has no box of
its own: `Range.getClientRects()` returns one rect per line *fragment*, including trailing
space, so "is the label centred" measured off the union of those rects was off by ~2 world px.
`.shape-label-inner` is now `display: inline-block` (a flex item: one tight box, still wrapped
by `overflow-wrap`), so the test reads one rectangle for centring and still counts line rects
for wrapping.

### Forcing the delete race without delaying WebSocket frames
The design suggests a Playwright route delay on the second screen's traffic. Playwright's
`route` cannot delay WebSocket frames, only the handshake, so TC-27 creates the overlap with
the app's own hooks: `dropConnection(dana)` → Dana draws the arrow onto a shape she can still
see → Sam deletes that shape → `resumeConnection(dana)`. Dana's arrow is attached to an object
that no longer exists, which is exactly `connector.target_deleted`: both screens resolve that
end to the stored fallback and neither invents a position. No console errors on either screen.

### Seeded connectors attach by object id
`SeedEndpoint` gained `objectId` (alongside `shapeIndex` and a plain point), so a fixture can
say "attach this end to that shape" without caring which id the hook made, and
`tests/fixtures/checkout-flow.ts` describes the whole flow declaratively:
`CHECKOUT_FLOW_SHAPES` + `CHECKOUT_FLOW_CONNECTORS` for the browser hooks, and
`buildCheckoutFlow(doc)` for the same flow built by direct model calls on a `Y.Doc` (the unit
test asserts its resolved ends, so the fixture cannot silently drift away from the browser
tests that rely on its numbers).

### Signatures that bite
`createSticky(doc, at, color)` centres the note on `at` on a fixed `STICKY_SIZE_WORLD` square
and returns `''` for an unknown colour — it is not a way to get a note of a given size (use
`seedNotes`, which takes width/height). `moveObjects(doc, positions)` takes a map of *absolute*
top-left positions, not deltas. `setShapeStyle`/`setConnectorEndpoint` return `false` when
nothing changed, so a no-op gesture writes nothing and no traffic leaves the tab.

### Component tests must act-wrap toolbar clicks
A `click` on a toolbar button outside `act` leaves React's state (and so `aria-pressed` and
the viewport's `data-tool`) in the previous frame: assertions then read stale values.
`clickTestId` in `tests/component/shapeUtil.ts` wraps the click; the Yjs observer fires
synchronously inside `act`, so hook-driven seeds re-render in the same call.

### TC-23 in Firefox and WebKit, re-attempted
`tasks.md` asks for the shape-drag case outside Chromium too. Re-run of
`VIDI6_BROWSERS=firefox,webkit npm run test:e2e -- shapes.spec.ts` fails before any board
loads: both cached binaries abort on launch (`exitCode=134`), exactly as recorded for stories
1–9. Chromium alone is therefore what this machine can prove; nothing about the shape code
differs per engine (an SVG figure, a foreignObject label, a stroked hit line — all standard).
