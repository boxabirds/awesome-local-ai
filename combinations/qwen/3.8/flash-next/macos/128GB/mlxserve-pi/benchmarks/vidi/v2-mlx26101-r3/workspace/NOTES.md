# vidi6 — working notes

Kept current by whoever works on the repo. Records verified commands, deviations from the
story design, and gotchas for the next story.

## Commands (all verified in this environment)

| Command | What it does |
| --- | --- |
| `npm install` | Install deps (Node 24, npm 11). |
| `npm run dev` | Vite dev server on `http://127.0.0.1:23600`. Story 1 has no server code, so no Worker is needed in dev. |
| `npm run build` | Production client build → `dist/client` with **stable** asset names (`assets/app.js`, `assets/index.css`). |
| `npm run build:test` | Same build with `MODE=test`, which compiles in the `window.__vidi6` e2e hook. Playwright's `globalSetup` runs it before any test, so a server that is already listening (and reads its assets off disk per request) serves fresh code too. |
| `npm run preview` | `wrangler dev` serving `dist/client` at `http://127.0.0.1:23612` (inspector port 23613) — the same serving path later stories use. |
| `npm run typecheck` | `tsc --noEmit` over `tsconfig.json` (client + shared), `tsconfig.worker.json` (Worker + shared, `@cloudflare/workers-types`), `tsconfig.test.json` (unit/component tests + Playwright) and `tsconfig.integration.json` (workerd tests). |
| `npm run test:unit` | 98 tests, node environment (camera 23, board model 25, sticky text 27, board id 5, protocol 7, …). |
| `npm run test:component` | 90 jsdom tests (viewport input, zoom controls, hint, sticky note, sticky text editor, toolbars, connection status badge). |
| `npm run test:integration` | 22 tests, 2 files, in **workerd** via `@cloudflare/vitest-pool-workers` (`SELF.fetch`, real `BoardRoom` Durable Object, real WebSockets, real Yjs). Needs `npm run build` first, because TC-06 asks the assets binding for `index.html`. |
| `npm test` | All three vitest projects (unit, component, integration) in one run. |
| `npm run test:e2e` | Playwright. Builds in `globalSetup`, then starts `npx wrangler dev --ip 127.0.0.1 --port 23614 --inspector-port 23615` (or reuses one already listening), viewport 1280×800, **Chromium only by default** (see deviation 1). 51 tests (story 1 23, story 2 20, story 3 8). The two `@nightly` tests are excluded here. |
| `BROWSERS=all npm run test:e2e` (or `npm run test:e2e:all-browsers`) | Chromium + Firefox + WebKit. |
| `npm run test:e2e:nightly` | Only the `@nightly` tests (TC-29 idle connection, TC-30 capacity soak). About 2 minutes; `NIGHTLY=1` is the switch, so `NIGHTLY=1 npx playwright test -g "TC-30"` runs one of them. |
| `npm run check:no-test-hook` | Fails if a built asset contains `__vidi6` (run after `npm run build`). |
| `npm run verify` | typecheck → build → no-test-hook → unit → component → e2e(Chromium). One command for the whole gate. |

Ports in use: dev `23600`, preview `23612/23613`, e2e `23614/23615` (override with
`DEV_PORT`, `E2E_PORT`, `E2E_INSPECTOR_PORT`).

## Deviations from `spec/stories/.../design.md`

1. **Non-Chromium Playwright projects are opt-in.** The design wants Chromium, Firefox and
   WebKit projects. All three are configured, but in this sandbox the bundled Firefox and
   WebKit binaries abort on launch (`SIGABRT` / `Abort trap: 6`; `BROWSERS=all` reproduces
   it) — an environment limit, not a product problem, so the default project list is
   Chromium only and the full matrix is one env var away. Everything the Safari/WebKit
   pinch path does is covered in jsdom with synthetic `gesturestart/gesturechange` events
   (`tests/component/BoardViewport.test.tsx`, TC-17/TC-17b).
2. **e2e runs on port 23614 (+ inspector 23615)** instead of a 3000-class port, because this
   agent may only bind 23600–23615.
3. **`wrangler.jsonc` has no Worker `main` and no `ASSETS` binding.** wrangler 4 rejects
   `Cannot use assets with a binding in an assets-only Worker`. Story 3 adds `main`; that is
   when `"binding": "ASSETS"` goes back in. `dev.port` / `dev.inspector_port` are set so
   `npm run preview` also stays inside the allowed port range.
4. **Stable built asset names** (`build.rollupOptions.output.*FileNames`). With content
   hashes, a `wrangler dev` that is already running 404s on the new hashed file (it builds
   its asset list at startup). Wrangler hashes assets itself on deploy.
5. **Extra e2e files** next to the designed `tests/e2e/navigation.spec.ts`:
   `layout.spec.ts` (board fills the window, `touch-action`/`overscroll-behavior`, `grab` and
   `grabbing` cursors, wheel over the controls does nothing, drags starting on the overlay do
   nothing, controls do not scale with zoom, dot-grid alignment to world grid lines, resize
   leaves content where it is, zoom keeps the viewport centre) and `touch.spec.ts` (touch drag pans via CDP
   `Input.dispatchTouchEvent`; skipped for non-Chromium projects).
6. **Interaction tests use `fireEvent` + real DOM events; only the zoom-control clicks use
   `user-event`.** Pointer/wheel/gesture sequences need exact event objects and
   `defaultPrevented` assertions. Fake timers are limited to
   `{ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] }`: faking every timer makes
   React's scheduler spin inside `advanceTimersByTimeAsync` and the test hangs.
7. **The world layer carries a `data-camera="x,y,zoom"` attribute.** It is the readout that
   pixel-free assertions (far-travel exactness) and debugging use.
8. **The e2e test hook is `window.__vidi6.setCamera({ x?, y?, zoom? })`**, applied without
   clamping x/y (jumping 1,000,000 units away is the whole point of the fixture).
9. **`src/server/` was not created** — nothing in story 1 needs server logic.
10. **One extra named setting:** `STICKY_PADDING_WORLD` (12) sits with the other sticky
    settings in `src/shared/config.ts`. The design lists note size, colours, text limit and
    font range as product settings; the text inset is the same kind of number and the auto-fit
    needs it, so it lives in the same place instead of being hardcoded twice.
11. **`StickyNoteProps` takes `zoom`, not the whole `camera`,** and its callbacks are
    `onStartEdit(id)` / `onEndEdit(next)` (`EditEnd = 'selected' | 'unselected'`) rather
    than the design's no-arg `onStartEdit()` / `onEndEdit()`: `BoardViewport` renders the notes,
    so it needs the id back, and `App` has to know *why* editing ended to keep the selection
    rule (Escape keeps it, a click outside drops it). `zoom` is all the drag maths needs — the
    translation cancels out of a delta.
12. **The note element is not the clipping box.** `.sticky-note` has no `overflow: hidden`,
    because the colour/delete toolbar hangs above the note's top edge and would be cut away;
    the inner `.sticky-note__clip` is the box that clips text (176×176 world units, i.e.
    `STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD`). e2e assertions about clipping therefore
    look at `.sticky-note__clip`, and `noteFontSize`/`textOverflow` read the textarea while
    editing and the clip after it (a `overflow: hidden` textarea is its own scroll container,
    so the overflow never reaches the clip while typing).
13. **The note toolbar counter-scales.** It is rendered in world coordinates inside the note
    (so it moves with the note for free) from a zero-size anchor at `left: 50%; bottom: 100%`
    with `transform: translateX(-50%) scale(var(--inv-zoom))`, `--inv-zoom` being `1 / zoom`
    from React. That is what "drawn in screen space, a usable size at any zoom" means here
    (e2e TC-34c asserts the toolbar is between 10 and 60 px tall at 50%).
14. **Escape is the editor's key, Enter/Delete/Backspace are the board's.** The textarea owns
    Escape in its own `onKeyDown`; `App` listens on `window` for Enter/F2 (edit the selected
    note) and Delete/Backspace (delete it), skipping anything whose target is an editable
    element. Component tests therefore press Escape with `pressKeyIn(editor, 'Escape')` and the
    rest with `pressKey(key)` (which fires on `window`).
15. **`bringToFront` happens on `pointerdown`, not when the drag threshold is crossed**, as the
    design's Step 4.2 says. A press that only selects still raises the note; the position is
    untouched until the threshold is crossed, which is what TC-19 ("2 px is a click") is about.
16. **Extra test files** beside the designed ones: `tests/unit/board-model.test.ts`,
    `tests/unit/sticky-text.test.ts`, `tests/fixtures/texts.ts`,
    `tests/component/StickyNote.test.tsx`, `tests/component/StickyTextEditor.test.tsx`,
    `tests/component/Toolbars.test.tsx`, `tests/component/helpers/sticky.tsx`,
    `tests/e2e/sticky-notes.spec.ts`, `tests/e2e/helpers/sticky.ts`.

17. **`test:integration` names the vitest pool by file, and turns `isolatedStorage` off.**
    Two environment problems, both in `vitest.config.ts`: vitest resolves a custom pool id
    with `require`-style export conditions and `@cloudflare/vitest-pool-workers` only
    publishes `import`, so the project points at `dist/pool/index.mjs`; and the pool's
    isolated storage cannot be unrolled around a Durable Object that is still holding open
    WebSockets (it aborts the run with "Isolated storage failed … Expected .sqlite, got
    …sqlite-shm"), which is unavoidable when the subject under test *is* a board with six
    live sockets. With `isolatedStorage: false` the whole file shares one runtime, which is
    also what makes the board-isolation tests honest.
18. **No extra setting for keeping a connection alive.** The design's setting list has the
    latency budget, the capacity and the backoff ceiling, and that is what `config.ts` has.
    A `WebsocketProvider` drops a connection it has heard nothing on for 30 s
    (`messageReconnectTimeout`), which an idle board would otherwise hit; it turns out nothing
    has to be added, because y-protocols' `Awareness` renews its own local state every
    `outdatedTimeout / 2` (15 s) and the room relays awareness to *every* socket including the
    sender. Every connection therefore hears something every ~15 s, which TC-29 measures: 45 s
    of an idle board, no badge, no new socket dialled, and a change still crossing in 236 ms.
    (An earlier revision of this story added `AWARENESS_HEARTBEAT_MS` and a `setInterval` in the
    client; it was redundant with the library's own renewal and is gone.)
19. **The room speaks the sync protocol in both directions.** On every accepted connection it
    sends its own SyncStep1, so a client's SyncStep2 fills the room in. That is what makes
    TC-18 ("the room restarts") work: the first client to reconnect hands the whole document
    back to the fresh object, so nobody loses notes while one person still has the board open.
    The design puts reconnection in story 4; the room's half of it costs four lines and is the
    only way a restart can be tested without mocking.
20. **`BoardRoom` does not hibernate** (`server.accept()` + `addEventListener`, no
    `getWebSockets()`), because the document lives in memory and hibernation would evict the
    object and lose the board. Story 4 (storage) is where hibernation belongs. See the class
    comment in `src/worker/board-room.ts`.
22. **Two e2e tests are tagged `@nightly` and excluded from `npm run test:e2e`.** TC-29 waits
    45 s to outlast the provider's 30 s silence timeout, and TC-30 soaks five browsers on one
    board for a minute (about 150 rounds of editing, 200-odd notes made and deleted). Together
    they take as long again as the other 51 tests, so they are a separate command
    (`npm run test:e2e:nightly`, `NIGHTLY=1` in `playwright.config.ts` selecting on the tag)
    rather than a thing every commit waits for. Their subject — a connection that has to stay
    up while nothing happens — cannot be tested any other way.

23. **The e2e test hook grew a second method: `window.__vidi6.dropConnection()`.** It calls
    `provider.disconnect(); provider.connect()` and exists because Chromium's
    `context.setOffline(true)` does not disturb a WebSocket that is already open (see the
    gotcha below), so a test cannot make an outage with offline alone. It is compiled in only
    under `MODE=test`, behind the same `IS_TEST_MODE` guard as `setCamera`, and
    `npm run check:no-test-hook` still has to pass. Both methods register through one
    `addHook(name, hook)` in `src/client/testHooks.ts`, so adding the third one is one line and
    each one's cleanup removes only its own key.

24. **`src/worker/` instead of `src/server/`.** The story-2 notes left the door open to
    `src/server/`; the design says "Worker entry `src/worker/index.ts`" and "BoardRoom
    Durable Object `src/worker/board-room.ts`", so those two paths are used, with their own
    `tsconfig.worker.json` (`@cloudflare/workers-types`, no DOM lib) and `tsconfig.json`
    excluding `src/worker`.

## Gotchas / findings for the next story

- **Coordinate contract** (everywhere): `screen = (world - camera.xy) * zoom`,
  `world = screen / zoom + camera.xy`. The world layer renders it as
  `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`. Swapping
  `scale`/`translate` shifts the world by a factor of zoom — three e2e tests fail if you do.
- **Never round `camera.x` / `camera.y`.** All pan/zoom maths stays in double precision so
  sub-pixel precision survives at 1,000,000 units out (PRD "No edges"). Only the *label*
  rounds (`zoomPercent`).
- **React attaches `wheel` as a passive listener at the root**, so `onWheel` +
  `preventDefault()` throws "Unable to preventDefault inside passive event listener". The
  board's wheel handling is a native `addEventListener('wheel', fn, { passive: false })` in
  `BoardViewport`. Keep it that way.
- **Drag vs. objects:** only elements carrying `data-board-surface` start a pan; anything
  inside `[data-board-ui]` (the overlay) is ignored by both the pan and wheel handlers.
  Story 2's sticky notes should call `stopPropagation()` on `pointerdown` to own their drag.
  `touch-action: none` (in CSS, not inline) is what stops the browser panning/zooming.
- **Pointer capture:** `setPointerCapture` on the viewport retargets later pointer events, so
  dragging continues even when the pointer is over the overlay. `onLostPointerCapture` ends
  the pan; `panningRef` (a ref, not state) is the synchronous source of truth.
- **`deltaMode` matters:** Firefox reports `DOM_LINE_NUMBER` (1) and some setups report pages
  (2). `wheelPixelScale` converts lines → `WHEEL_LINE_HEIGHT_PX` and pages → viewport height,
  otherwise panning feels 3× slower in Firefox.
- **Safari `gesture*` events** carry `scale` measured *since the gesture started*, so zoom is
  applied incrementally (`scale / lastScale`). A test that uses scales 1 → 2 → 4 cannot catch
  the difference because the clamp at 4 hides it — the component test uses 1.2 → 1.5 for that
  reason.
- **Camera updates are coalesced with rAF** (at most one render per frame), so any assertion
  on the DOM must wait a frame: `settle()` (e2e, two `requestAnimationFrame`s) or
  `flushFrames()` (component). `useCamera` also keeps `cameraRef` synchronously up to date,
  which is what makes rapid-fire events exact.
- **A window resize never moves the camera.** `useCamera` seeds the standard view from
  `resetCamera({ width: window.innerWidth, height: window.innerHeight })` at first render and
  the `ResizeObserver` size is only used for page-mode wheel deltas and the zoom-step centre.
  (PRD "Resizing the browser window does not move content relative to the top-left corner" +
  design "camera x, y is unchanged by design"; asserted by TC-07 component and the e2e resize
  test.) Because of that, jsdom component tests must emulate the window size —
  `tests/component/setup.ts` redefines `window.innerWidth/innerHeight` to 1280×800 to match the
  e2e viewport; jsdom's own 1024×768 would give a different standard view.
- **jsdom gaps:** no `ResizeObserver` (stub in `tests/component/resizeObserver.ts`, drive it
  with `setObservedSize()`), and essentially no CSS cascade/layout — element rects are 0×0,
  so pixel assertions there are impossible (the origin marker still gives a usable centre
  because it has a fixed CSS size and is centred by a counter-scale). CSS-level regressions
  belong in e2e: the e2e run caught a real one (`overscroll-behavior` was only on
  `html, body`, not `.board-viewport`) that jsdom happily reported as correct.
- **The dot grid** is a CSS `radial-gradient` background on a full-viewport layer:
  `background-size = GRID_SPACING_WORLD * zoom`, `background-position =
  mod(-camera.xy * zoom, spacing) - spacing/2` (the half-tile correction is what puts a dot
  exactly on a world grid line — `layout.spec.ts` asserts that).
- **Zoom step snapping:** `zoomStep` snaps a target zoom to the nearest `ZOOM_STEP_FACTOR^n`
  within `ZOOM_STEP_SNAP_EPSILON * max(1, snapped)` so step-in → step-out returns to the exact
  zoom it started from; labels then read 100 → 125 → 156 → 195 → 244 → 305 → 381 → 400 (the
  last one is a clamp, not a power of 1.25). The e2e test derives that sequence from the pure
  maths instead of hardcoding it.
- **Sandbox limits worth remembering:** `/tmp` is not writable (scratch files go in `.logs/`,
  which is gitignored), `ps` / `pkill` / `lsof` return nothing, so a manually started
  `wrangler dev` cannot be killed — let Playwright own the e2e port. A stale `wrangler dev`
  on the e2e port is served by `reuseExistingServer: !CI`, so if you ever change asset names,
  change the port too.
- **Story 2 addition, same subject:** `npm run verify`'s last step can therefore be served by a
  `wrangler dev` that is still holding the *production* build `npm run build` just wrote. Run
  `npm run build:test` before `npx playwright test` when a wrangler is already listening on
  23614, or point `E2E_PORT` / `E2E_INSPECTOR_PORT` at free ports inside 23600–23615 and let
  Playwright start its own server.
- **Production must stay hook-free:** `npm run check:no-test-hook` greps the built assets for
  `__vidi6`. It is part of `npm run verify`.
- **Bringing an object to the front takes your pointer capture away.** Notes (and, later,
  every object) are painted in DOM order, so `bringToFront` changes a `z` and React *moves the
  element* — and Chromium answers that with `lostpointercapture` on the first `pointermove`.
  A drag that listens only on its own element therefore ends before it starts, which is
  exactly the bug story 2 had: pressing a note that was not already on top raised its `z` and
  then never moved. jsdom cannot show this (it never fires `lostpointercapture`), so only the
  e2e run caught it. `StickyNote` now tracks `pointermove` / `pointerup` / `pointercancel` on
  `window` for the length of the press, and `lostpointercapture` is ignored while
  `event.buttons !== 0` (the pointer is still down, this is only the reorder); with the button
  released it still ends the drag, as the design's state machine asks. **Story 7 (multi-select
  drag) and story 11 (pen strokes) must do the same** if their gesture changes stacking.
- **`preventDefault` on a keydown that bubbled through a note kills the keystroke.** The note
  cancels Space so the page behind the board does not scroll; doing that unconditionally meant
  a space typed into the note's own textarea never reached the text (`First` + ` idea` came
  out as `Firstidea`). The note's `onKeyDown` returns early when `editing`, and whenever
  `event.target !== event.currentTarget`. `fireEvent.keyDown` gives back `false` when a handler
  cancelled the event, which is how the component test (TC-26b) pins both directions.
- **Notes are drawn in stacking order, so the DOM order is not stable.** Anything that happens
  around a drag looks notes up by id (`noteById`, `stateById`, `centreByIdOnScreen`,
  `toolbarById` in `tests/e2e/helpers/sticky.ts`) instead of by index; `noteIds()` and
  `waitForNote(page, n)` are for the cases where the order *is* the subject. `unchanged(state)`
  compares the fields a drag must not touch — selection is deliberately not one of them,
  because grabbing one note lets go of another.
- **Playwright 1.63 renamed the focus matcher:** it is `await expect(locator).toBeFocused()`;
  `toHaveFocus` no longer exists in the type definitions.
- **jsdom reorders DOM nodes too,** so a component test *can* lock in the stacking part of the
  fix (`TC-20c`: drag the note underneath another one), and `loseCapture(el, at, { buttons })`
  lets a test say which kind of capture loss happened.

- **lib0's `Decoder` holds `arr`, not `source`** (lib0 0.2.119). Reading the rest of a frame
  with `decoder.source.length` throws "Cannot read properties of undefined (reading
  'length')" - and because `decodeMessage` catches, every valid frame came back as
  `{ kind: 'invalid' }`, so the room closed every client with 1003 and the integration tests
  looked like a WebSocket problem. Use `decoding.readUint8Array(decoder, left)`; `arr` may be
  a view on a bigger buffer, which is why the payload has to be copied.
- **`crypto` is a global, not a `globalThis` property, in the Worker type set.**
  `@cloudflare/workers-types` declares `declare const crypto: Crypto`, so
  `globalThis.crypto` does not typecheck under `tsconfig.worker.json` even though it does
  under the DOM lib. `src/shared/board-model.ts` now reads the bare identifier behind a
  `typeof crypto === 'undefined'` guard, which both type sets accept.
- **WebSockets over `SELF.fetch` work** in `@cloudflare/vitest-pool-workers`: send
  `headers: { Upgrade: 'websocket' }`, read `response.webSocket`, `accept()` it - that is the
  whole fixture (`tests/integration/helpers/ws-client.ts`), and it speaks the same bytes as
  the browser provider. A Durable Object stub answers an upgrade the same way
  (`stub.fetch(new Request(..., { headers: { Upgrade: 'websocket' } }))`), which is how a
  fresh object instance - a restart - is reached without any mock.
- **A room that only answers is a room nobody hears.** `WebsocketProvider` closes a
  connection after `messageReconnectTimeout` (30 s) of silence; the room stays quiet on an
  idle board, so the client has to keep talking. Awareness is the cheapest thing to send:
  `awarenessProtocol.updateAwarenessState(awareness, {})`... in practice the provider's own
  `setAwarenessField`/`awareness.setLocalStateField` renewal every `AWARENESS_HEARTBEAT_MS`
  does it, and the room relays awareness to the sender too, so both ends see traffic.
- **`assets.run_worker_first` is required once the Worker exists.** With
  `not_found_handling: "single-page-application"` the assets layer would answer
  `/api/rooms/<id>` with `index.html` (200, no upgrade) and the Worker would never see the
  route. `run_worker_first: ["/api/*"]` keeps the SPA fallback for `/b/<id>` (which is what
  TC-06 needs) and gives the Worker its endpoint.
- **The installed workerd rejects the repo's `compatibility_date`** ("latest compatibility
  date supported … is 2026-03-10, but you've requested 2026-09-01") and falls back with a
  `miniflare:warn` line on every integration/e2e run. It is a warning only; DO SQLite,
  WebSockets and `nodejs_compat` all work. Do not "fix" it by lowering the date - deploy
  targets are newer than this local runtime.

- **`y-protocols/sync` swallows an undecodable Yjs update.** `readSyncMessage(decoder, encoder,
  doc, origin)` catches whatever `Y.applyUpdate` throws, `console.error`s it and returns as if
  the message had been read - so wrapping that call in try/catch never sees the failure and the
  room keeps the socket that sent garbage (TC-15 hangs on "waiting for the socket to close").
  The 5th parameter is an `errorHandler`; `src/worker/board-room.ts` passes one that records the
  error and then closes that socket with 1003. The library's own
  "Caught error while handling a Yjs update" line still appears once in the TC-15 output - that
  is y-protocols logging, not a failing test.

- **y-websocket hands you a `Blob`, not an `ArrayBuffer`, when the bytes come through a
  Durable Object.** `decodeMessage` in `src/shared/protocol.ts` reads the rest of a frame with
  `readUint8Array(decoder, left)`, which wants `arr.buffer`; a frame that arrived over a plain
  server-side WebSocket is an `ArrayBuffer` and works, and a frame that arrived through
  `connectBoardSocket` (the browser provider talking to the room) arrives as a `Blob` in workerd
  and decodes to garbage. `frameData()` in that file converts `Blob → ArrayBuffer` with
  `await blob.arrayBuffer()` first; `handleMessage` is `async` because of it. Anything else that
  reads a y-websocket frame out of a DO has the same problem.
- **`context.setOffline(true)` in Chromium does not kill a WebSocket that is already open.** It
  blocks new dials and new `fetch`es; existing sockets keep working, which makes an "offline"
  test pass without ever having been offline. A real outage in a test is two moves: drop the
  socket (`window.__vidi6.dropConnection()`) and *then* set the context offline so nothing
  reconnects. TC-27's whole sequence depends on that: `(hidden) -> Reconnecting… -> Connected ->
  (hidden)`, in 38 s with a 30 s outage (`CATCH_UP_TEST_OUTAGE_MS`) instead of the 65+ s a
  timeout-driven version took.
- **A text editor on a shared `Y.Text` must write the *diff from what it last saw*, never the
  whole value.** `applyTextDiff(ytext, next)` computes the smallest diff between the current
  document text and `next`, which is right for a single writer and destroys the other person's
  keystroke the moment two people are in the same note (their whole string wins, mine vanishes).
  `StickyTextEditor` therefore keeps a `baseline` — the text it last saw the document hold — and
  writes `textEdit(baseline, value)` through `applyLocalEdit`, so each keystroke is its own
  operation and Yjs merges both. The remote half is the other direction: on a remote
  `ytext.observe` the textarea adopts `ytext.toString()` and the caret is put back with
  `mapCaret(event.delta, selectionStart)`; changes that arrive *during* an IME composition are
  held in `pendingRef` until `compositionend` and then applied as an insertion, because replacing
  the value mid-composition throws the composition away.
- **An editor left open on a page makes the next `createStickyButton.click()` return a stale id.**
  The click goes nowhere (the open textarea has the keyboard), so `editingNoteId(page)` answers
  with the *old* note's id and a soak that counts notes made is suddenly five notes short of the
  board it is looking at — which is exactly how TC-30 reported itself broken. Any test branch
  that opens an editor and decides to do nothing has to press Escape on the way out.
- **A note that is lying under another note has a toolbar that exists and cannot be clicked.**
  Playwright waits for the element, then waits for the hit target at its centre to be itself,
  and after 10 s gives up — in a soak where people are dragging notes into each other's slots
  that is a certainty, not a flake. `isClickable(locator)` in `tests/e2e/helpers/sticky.ts`
  asks the question directly (`document.elementFromPoint` at the element's own centre) and the
  round does nothing instead of timing out. Related: reach a note's Delete / colour swatch
  through the note (`deleteNoteButtonIn`, `colourSwatchIn`), because by the time five browsers
  are running, a page-wide `getByRole('button', { name: 'Delete note' })` is not one button.
- **`reuseExistingServer` plus a build in `globalSetup` is what keeps a reused `wrangler dev`
  honest.** wrangler reads its assets off disk per request, so the server does not need
    restarting to serve new code — it needs the *build* to have happened, which is why
    `npm run build:test` moved out of `webServer.command` into `tests/e2e/global-setup.ts` (a
    reused server never runs `webServer.command`). `npm run verify` ends with `npm run build`,
    which leaves `dist/client` holding the production bundle; the next e2e run's `globalSetup`
    puts the test build back before Playwright starts clicking.
- **A room that relays awareness to the sender is what an idle connection hears.** See
  deviation 18; the measurement is in TC-29's console line, and the reason TC-29 asserts "no
    new WebSocket was dialled" rather than merely "the badge never appeared".

## Where story 4 plugs in

- `src/client/board/useBoardDoc.ts` owns the `Y.Doc` (one per mounted board, `initDoc` makes
  sure the `objects` map exists) and `useBoardDoc().notes` gives the render list, sorted by
  `(z, id)`, through `useSyncExternalStore` with a `observeDeep` store. A network provider only
  has to attach to that document — nothing in the rendering path changes, and story 3 proved it:
  `connectBoard` attaches and no component below `App` knows the difference.
- Every mutation in `src/shared/board-model.ts` is exactly one `doc.transact(fn,
  LOCAL_ORIGIN)` (a `unique symbol`), so an update can be told apart from an echo: story 8's undo
  groups by it. Rejected operations leave no transaction at all.
- Text lives in a `Y.Text` per note (`getStickyText`). `applyTextDiff` writes the smallest diff
  (still the right tool for a whole-value replace from a test or a model operation); a *typing*
  person goes through `applyLocalEdit` with a baseline instead — see the gotcha above.
- `src/worker/board-room.ts` holds the document in memory only: `state` is unused, nothing is
  written to SQLite, and a restart is survived today only because a client re-sends its
  document (deviation 19). Story 4's persistence belongs in `state.blockStorage`/`list` with
  `setWebSocketAutoResponse` hibernation replacing the `addEventListener` wiring — but only once
  the document can be reloaded, because hibernation evicts the object and this story's room
  would lose the board. `MAX_CONCURRENT_EDITORS` is *reported* by the design as a capacity, not
  enforced: nothing in the room turns a sixth socket away, and TC-30's soak is what says five
  browsers on one in-memory board is fine.
- `useSelection` stays local UI state. The provider's awareness carries who is on the board and
  is relayed verbatim by the room; story 5's presence/cursors should read it from
  `provider.awareness` rather than invent a second channel, and must not put selection in it.
- `tests/e2e/helpers/participants.ts` is the multi-client fixture now: `Cast.open(browser,
  ...names)` for one page per person with console watching (`person.problems`),
  `waitForSameBoard` / `boardJson` / `faces` for "the whole room agrees", `loseConnection` /
  `restoreConnection` for an outage, `stayShowing(page, text, ms)` for "the badge never
  flickered", and `logScenario` / `logLatency` for the numbers the nightly tests print. Adding a
  sixth person is `Cast.open(browser, ...NAMES)` — `NAMES` has six.
