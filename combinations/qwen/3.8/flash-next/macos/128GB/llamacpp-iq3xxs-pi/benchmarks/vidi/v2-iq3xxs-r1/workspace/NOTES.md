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
