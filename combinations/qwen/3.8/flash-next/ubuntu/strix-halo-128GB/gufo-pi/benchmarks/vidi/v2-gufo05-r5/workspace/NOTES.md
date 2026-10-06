# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Environment
- Node v22.22.1. Some transitive packages warn they want `^22.22.2` (EBADENGINE warning only, everything works).
- Playwright browsers are at `PLAYWRIGHT_BROWSERS_PATH=/w/browsers`: Chromium 1243, Firefox 1543, WebKit 2359.
- **Firefox and WebKit cannot start on this machine — blocked.** Firefox exits with
  `XPCOMGlueLoad error ... libgtk-3.so.0: cannot open shared object file`; WebKit reports a longer
  missing list (GTK, GStreamer, flite, and `libicu*.so.74`, while this Ubuntu 26.04 image ships ICU 78).
  Fixing it needs `npx playwright install-deps` (root), but `sudo` is blocked (`no new privileges`) and
  the Ubuntu archives are unreachable (`apt-get download libgtk-3-0t64` cannot locate the package).
  The Firefox/WebKit test code is written and browser-agnostic; only launching is impossible here.
  See "Running the e2e suite" below for how the config handles it.
- Servers use the reserved port range 28816-28831: e2e `wrangler dev` on 28816 (inspector 28817),
  `vite dev` 28820, `vite preview` 28821.

## Running the checks
```bash
npm run build          # production client build (dist/client), excludes the test hook
npm run typecheck      # tsc --noEmit over src, tests and the config files
npm run test:unit      # Vitest project unit  (node)            - 17 tests
npm run test:component # Vitest project component (jsdom)       - 29 tests
npm run test:e2e       # Playwright against `wrangler dev`      - 11 tests per launched browser
npm run dev            # vite dev server on 28820
npm run wrangler:dev   # serve dist/client through wrangler dev on 28816
```
`npm run test:e2e` builds the client with `--mode test` and serves it with `wrangler dev`, i.e. the same
serving path production will use. Set `PLAYWRIGHT_BROWSERS_PATH=/w/browsers` if the browsers are not in
the default cache.

## Running the e2e suite on hosts without every browser
`playwright.config.ts` probes each engine once in the main process and only creates projects for browsers
that actually launch, printing e.g.

```
[vidi6] e2e: skipping "firefox" - its browser cannot launch on this host (missing system libraries;
try "npx playwright install-deps firefox"). Its tests stay in the suite and run on a host that has them.
```

The decision is passed to worker processes through `VIDI6_E2E_ENGINES` (the config file is evaluated again
inside each worker). Setting `VIDI6_E2E_BROWSERS=chromium,firefox,webkit` pins the engine list: a pinned
engine that cannot start makes the run fail, so CI with the system dependencies installed can never
silently drop a browser. On a host with all three (CI with `playwright install-deps`) the same 11 tests
run in Chromium, Firefox and WebKit; here they run in Chromium only.

## Design decisions
- **Where the camera state lives.** The design fixes two component contracts: `useCamera(viewport: Size)` and
  `BoardViewport({ children })`, and also says `App.tsx` wires `ZoomControls`/`NavigationHint` to the camera. To keep
  both signatures exactly as designed, a small `CameraProvider` (`src/client/canvas/CameraProvider.tsx`) owns the
  viewport measurement and the `useCamera` controller and shares them through React context. `App.tsx` renders
  `<CameraProvider>` with `<BoardViewport>` plus a `BoardChrome` component (defined in `App.tsx`) that reads the
  controller from context and passes the props designed for `ZoomControls` and `NavigationHint`.
- **Origin marker.** Rendered as a screen-space overlay inside the viewport (not inside the scaled world layer) and
  positioned at `worldToScreen(camera, {0,0})` with `transform: translate(-50%, -50%)`. This keeps its size constant at
  any zoom and makes the centre of its bounding box exactly the projection of world (0,0), which is what the e2e tests
  measure. It has `pointer-events: none` so it never blocks panning.
- **Panning starts unless the gesture begins on a board object.** Story 1 has no objects, so instead of a whitelist of
  "viewport or grid" the viewport checks `event.target.closest('[data-board-object]')`: panning starts for the
  viewport/grid/world layer and is left alone for objects added by later stories (which set that attribute and stop
  propagation). Covered by a component test that injects such an element.
- **`deltaMode` conversion constants** (`WHEEL_LINE_MODE_PIXELS`, `WHEEL_PAGE_MODE_PIXELS`) and the zoom-step snapping
  tolerance (`ZOOM_STEP_SNAP_TOLERANCE`), `PERCENT` and `GRID_DOT_SIZE_SCREEN` are extra named settings added to
  `src/shared/config.ts` next to the six the design names.
- **Zoom-step snapping happens inside `zoomAt`** (relative tolerance `ZOOM_STEP_SNAP_TOLERANCE`) rather than only in
  `zoomStep`, because `zoomAt` recomputes `zoom * factor`; snapping there means `zoomStep` can hand over the exact
  target zoom and 1.25 → 1.0 is exact (TC-09). Consequence worth knowing: after the zoom is clamped at `ZOOM_MAX`
  (400%) it is off the `1.25^n` lattice, so one step out gives 320% rather than 305% — the e2e test asserts that.
- **`useCamera` additionally exposes `setCamera`** (used by the test-mode `window.__vidi6` hook to jump far away). It
  goes through the same update path as any other camera change.
- **Camera updates are coalesced with `requestAnimationFrame`**; the ref holding the camera is updated synchronously so
  a burst of pointermove events never loses distance, only renders are coalesced. Because of the coalescing, tests
  assert through `expect.poll`/`toHaveText` (or by running a frame) instead of reading synchronously.
- **Initial view** is `resetCamera(size)` once the viewport has been measured (the first measurement is treated as the
  initial layout; later resizes keep `x`, `y` per the design, verified in a manual check: content stays fixed relative
  to the top-left of the board area).
- **Page zoom suppression** is done with a non-passive `wheel` listener on the viewport element (React's `onWheel` is
  passive), Safari `gesturestart`/`gesturechange` handlers, and a window `keydown` handler that prevents Ctrl/Cmd +
  `=`, `-`, `0`. Shortcuts are ignored when the event target is a text field (defensive; story 1 has none).
- **Scroll direction**: a plain wheel moves the camera by `+delta`, i.e. content moves opposite to the scroll
  direction (scroll down → content up, scroll right → content left), matching the PRD's verification text.

## Test technique
- **Component tests drive frames, not wall clock.** `tests/component/helpers.tsx` exposes `runFrames()`, which
  advances the animation frame that the camera update was scheduled on and flushes React. `BoardViewport.test.tsx`
  and `NavigationHint.test.tsx` use `vi.useFakeTimers()` as the design suggests, so frames are deterministic.
- **`ZoomControls.test.tsx` keeps real timers.** `@testing-library/user-event` v14 hangs when Vitest's fake timers
  are installed (its internal waits never run), so the one file that needs realistic pointer/keyboard interaction
  uses real timers. It does not need frame control: `ZoomControls` is stateless.
- **jsdom stubs**: `tests/component/setup.ts` installs a no-op `ResizeObserver` (jsdom has none). The board's first
  measurement falls back to `window.innerWidth/innerHeight` (1024x768 in jsdom), which keeps component expectations
  computable, e.g. the initial camera is `(-512, -384, 1)`.
- **jsdom does not implement key activation of buttons** (Enter/Space on a focused button fires no click), so the
  keyboard-accessibility test asserts tab order and focus, and activates with a click.
- **jsdom has no `GestureEvent`**, so `dispatchGesture` builds a plain cancelable `Event` and defines
  `scale`/`clientX`/`clientY` on it (TC-17).
- **Wheel and key events are dispatched manually** (`dispatchWheel`, `dispatchKey`) because `fireEvent` returns a
  boolean rather than the event, and TC-15/16/17/18 must assert `event.defaultPrevented`.
- **`window.__vidi6` in component tests**: Vitest runs with `MODE=test`, so the hook is registered and component
  tests can read the live camera; e2e uses the same hook through `page.evaluate`.

## Verified manually in Chromium (in addition to the automated suites)
- `visualViewport.scale` stays 1 and `devicePixelRatio` is unchanged after Ctrl+wheel, pinch-style gesture
  events and Ctrl/Cmd + `=`/`-`/`0` (TC-31 is automated too).
- Resizing the window (1280x800 → 1000x700) leaves the marker and the camera untouched: content does not move
  relative to the top-left of the board area.
- Dragging with the pointer outside the window mid-drag ends the drag through `lostpointercapture`, leaving the
  board where it was.
- Cursor is `grab` at rest and `grabbing` while panning.

---

# Notes for story 2 (Capture ideas on sticky notes and rearrange them)

## Running the checks (story 2 numbers)
```bash
npm run build          # production client build (dist/client), excludes the test hook
npm run typecheck      # tsc --noEmit over src, tests and the config files
npm run test:unit      # Vitest project unit      (node)  - 53 tests (board model, sticky text, story 1 camera)
npm run test:component # Vitest project component (jsdom) - 53 tests (24 story 2 notes/toolbars + 29 story 1)
npm run test:e2e       # Playwright               - 34 tests per launched browser
```
Everything passes. Firefox and WebKit still cannot launch on this machine (see the story 1 section:
missing GTK/ICU system libraries, `sudo` blocked), so `npm run test:e2e` runs the Chromium project
here and prints the skip warning for the other two; the note tests are browser-agnostic and contain
no Chromium-only code.

## Design decisions
- **`createSticky` returns `''` when it rejects the point.** The contract returns `string` and the
  error row says "returns false; 0 updates" for non-finite coordinates. An empty string is the
  falsy member of the return type: callers do `const id = createSticky(...); if (!id) return;` and
  nothing is written to the doc (asserted in TC-39).
- **`STICKY_PADDING_WORLD` (16) is an extra named setting** in `src/shared/config.ts` next to the
  ones the design names. The note's text box (`STICKY_TEXT_BOX_WORLD` = 200 - 2 x 16 = 168) is what
  `fitFontSize` measures against, and the same value is handed to CSS through `--note-padding`, so
  layout and fitting cannot drift apart.
- **`useBoardDoc` owns the `Y.Doc`** (`useState(() => new Y.Doc())` + `initDoc`) and exposes an
  immutable snapshot through `useSyncExternalStore`, recomputed on `objects.observeDeep`. Selection
  and editing live in `useSelection` (local React state) and are never written to the doc, exactly
  as the design requires.
- **`BoardViewport` grew two optional props** - `onCreateAt(point)` and `onClearSelection()` - and
  keeps its `children` slot. The viewport decides *that* empty board space was double-clicked or
  clicked without panning; `App` decides *what* that means (create a note at `screenToWorld(point)`,
  clear the selection). A pan keeps the selection; a click without movement clears it; a cancelled
  gesture changes nothing. Gestures that start on `[data-board-object]` are still ignored, and a
  note's `pointerdown` calls `stopPropagation`, so dragging a note never pans the board (TC-20).
- **Double-click uses the native `dblclick` event.** Chromium does fire `dblclick` after
  `preventDefault()` on `pointerdown` (checked in a probe before choosing this), so no manual
  double-tap timer is needed. A `dblclick` that lands on a note is stopped there and edits that
  note instead of creating a second one (TC-35).
- **The note toolbar is counter-scaled, not re-positioned.** It is rendered inside the note (so it
  needs no camera coordinates) with `transform: scale(var(--note-inverse-zoom))`, which keeps it the
  same size on screen at 50%, 100% and 200%. The design does not name a size for it; an extra e2e
  test pins the behaviour so a later story cannot quietly make it grow with zoom.
- **Auto-fit is measured in world units.** `fitFontSize` runs on the un-scaled element (the world
  layer carries the zoom transform), so the fitted size is a property of the text and the note, and
  zooming never triggers a re-measure. Binary search over integer px in
  `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]`; if it does not fit at the minimum, the text is clipped
  by `overflow: hidden` and a bottom fade is rendered (`data-overflow`, `.sticky-note__fade`).
- **Editing writes on every input event**, so ending editing (Escape, click outside, blur) writes
  nothing more. The diff is the minimal common-prefix/suffix insert-delete, never a rewrite, so
  text someone else typed at the same time survives (a two-doc merge test asserts this). IME
  composition defers the write to `compositionend`, and a truncated input restores the caret.
- **A note that disappears mid-interaction is silent.** `moveObject`/`setStickyColor`/
  `deleteObject`/`bringToFront` return `false` for a stale id and write nothing; the note component
  resets its drag state when its id changes, and the editor checks `ytext.doc` before writing (a
  deleted note's `Y.Text` is detached). Covered by TC-37 in both component and e2e tests - the e2e
  one deletes the note with the Delete key while the pointer is still down.
- **Colours are only the six names** in `STICKY_COLORS`; `setStickyColor` rejects unknown names and
  a no-op recolour to the same colour, and `StickySnapshot.color` is typed `StickyColor`.

## Test technique (story 2)
- **Test hook extended**: `window.__vidi6` now also has `getDoc()` and `getNotes()` (test builds
  only, same `IS_TEST_MODE` gate as story 1). Component tests use them to run model calls the UI has
  no button for (deleting mid-drag), e2e tests use `getNotes()` for world positions, which is far
  more stable than reading pixels.
- **Component tests drive the note with `fireEvent.pointer*` and real timers.** jsdom has no
  `setPointerCapture` (the component calls it optionally), and rAF is flushed with the existing
  `runFrames()` helper, so the drag/threshold logic is deterministic without fake timers.
- **Text is typed with `page.keyboard.insertText`** in e2e, which delivers a whole string as one
  input event, i.e. behaves like a paste (that is what TC-14 and TC-33 need).
- **This environment's `@playwright/test` build (1.63) lacks `test.each`, `locator.insertText` and
  `page.getByLabelText`**, so the specs use two explicit tests instead of `test.each`,
  `page.keyboard.insertText` and `page.getByLabel`. Nothing else in the suite depends on that.
- **`getComputedStyle` returns `rgb(...)`, not the configured hex**, so the e2e helper converts
  `STICKY_COLORS` values with `cssColor()` before comparing.
- **Font fitting needs real text layout**, so it is asserted in e2e only (TC-33): one word =
  24 px, a few lines = smaller, 1,000 characters = at or above 10 px with `scrollHeight >
  clientHeight` and the fade present, and back to 24 px when the text is short again.
- Extra tests beyond the design's list, kept because they are cheap and guard decisions above:
  CRDT merge of a minimal diff with concurrent typing, surrogate-pair safety, a drag released
  outside the note, rapid creation, the counter-scaled toolbar, and Enter/Delete behaviour in e2e.

## Running the checks (story 3 numbers)
```bash
npm run build            # unchanged: the window.__vidi6 test hook stays out of this bundle
npm run typecheck        # src + tests (tsconfig.json) and the worker (tsconfig.worker.json)
npm run test:unit        # 69 tests - adds board ids and protocol decoding
npm run test:component   # 62 tests - adds the connection badge (TC-19 to TC-21 and around it)
npm run test:integration # 28 tests - real Worker and real Durable Objects in workerd
npm run test:e2e         # 41 tests in chromium - TC-22 to TC-28 plus stories 1 and 2
npm run test:e2e:nightly # 2 tests - 45 s idle stability, 60 s soak at MAX_CONCURRENT_EDITORS
```
The nightly scenarios carry `@nightly` in their title: `test:e2e` inverts that match so they never
run twice, and `test:e2e:nightly` runs only those, with one worker so its latency report is not
measuring two suites competing for the machine. Last full run, all green:

| suite | result | latency, where it is reported |
|---|---|---|
| unit | 69 passed | - |
| component | 62 passed | - |
| integration | 28 passed | asserted within `LIVE_UPDATE_LATENCY_BUDGET_MS` |
| e2e | 41 passed (38 s) | TC-26: p50=19ms p95=49ms max=97ms |
| nightly | 2 passed (1.8 min) | TC-30: 955 changes, p50=5ms p95=9ms max=16ms |

An outage in TC-27 was noticed 10.9 s after the last frame and the board was live again about 2 s
after the network came back; both are logged, and only the badge states are asserted.

## Design decisions (story 3)
- **The Worker only routes**: `/api/rooms/<boardId>` with a WebSocket upgrade goes to that board's
  `BoardRoom` (`idFromName(boardId)`, one object per board id, which is what keeps separate boards
  separate in the tests); anything else, including the same path without `Upgrade: websocket`,
  returns `426 Upgrade Required`. There is no session and nobody is counted, so a 6th person on a
  board is connected exactly like the first.
- **`new WebSocketPair()` + the non-hibernating `server.accept()`**, deliberately: the document
  lives in the object's memory in this story, and hibernation would evict the object while sockets
  stay open and silently drop the board. Story 4 switches to `acceptWebSocket()` once the document
  can be reloaded from storage.
- **Workerd hands binary WebSocket messages as a `Blob`**, not an `ArrayBuffer` (`message instanceof
  Blob` is true, `ArrayBuffer.isView` is false), and reading it is asynchronous. `toFrameBytes()`
  normalizes `Blob | ArrayBuffer | ArrayBufferView | string`, and both the room and the integration
  clients chain message handling per socket so one socket's frames stay in order - the initial
  SyncStep1 / SyncStep2 handshake only works step by step.
- **Wire format**: a sync frame is `varUint(0)` followed by the y-protocols message *itself* (step
  byte included) with **no length prefix**; only awareness frames are `varUint8Array`-prefixed.
  Wrapping sync payloads in `varUint8Array` works between equals and nowhere else - a real
  `WebsocketProvider` hands the rest of the frame straight to `readSyncMessage`.
  `src/shared/protocol.ts` owns both directions (`decodeMessage`, `syncFrame`).
- **A bad frame costs one socket**: text, truncated, unknown type, or a payload Yjs rejects close
  that socket with `1003` and leave the document and every other participant untouched.
  `y-protocols` does not throw on an unusable update - `readSyncMessage` reports it through its
  `errorHandler` - so the room turns that callback into a close by hand.
- **A restarted room is repopulated by the client**, not by storage: on every (re)connection the
  room sends SyncStep1, so the newcomer answers with a SyncStep2 holding everything the fresh room
  lacks. That is what TC-18 asserts, and it is why a reload during a sync storm never loses work.
- **`RESYNC_INTERVAL_MS` (5 s) re-sends a SyncStep1** while a board is idle: y-websocket 3.1.0
  sends no ping of its own and closes after `messageReconnectTimeout` (30 s) of silence. The design's
  "clients renew awareness periodically" describes the need; this provider version has no awareness
  ping to renew with. Five seconds instead of, say, twenty, because it is also what tells the tab
  below that the wire is dead.
- **`CONNECTION_IDLE_TIMEOUT_MS` (8 s) is how long a tab waits for a silent wire**: a browser does
  not notice a network that goes away quietly, and y-websocket only gives up after 30 s. The 5 s
  resync means anything quieter than that is dead, so `webSocketWithIdleTimeout()` wraps the socket
  class, timestamps the last frame in, and - on silence - gets the provider to disconnect and dial
  again. It does *not* call `socket.close()`: on a dead network the browser sits in CLOSING waiting
  for a close frame that is never coming. Measured in Chromium, an outage is reported 9 s after the
  last frame and the board is live again about 2 s after the network returns.
- **`window`'s `offline`/`online` events are listened to as well** and drop the badge to
  "Reconnecting…" on the spot. They are a bonus, not the mechanism: in this sandbox `navigator.onLine`
  is already false with nothing switched off, and Playwright's offline mode never fires them.
- **A story 2 defect, found by dragging a second note**: a drag raises the note it drags, the render
  order follows `z`, and re-ordering the children moves the dragged note's DOM node - which drops
  pointer capture, and `onLostPointerCapture` treated that as a cancelled drag. So dragging any note
  that was not already on top stopped dead on the first move, and no story 2 test caught it (they
  only ever dragged the topmost note). `StickyNote` now takes the capture back when it is lost with
  the button still down, and lets a real release end the drag. jsdom has no pointer capture, so the
  e2e multi-note cases (TC-26, TC-30) are what cover this.
- **`connectBoard()` is a wrapper around the real `WebsocketProvider`** and owns the badge's state
  machine (design table): `status: 'connecting'` before the first sync, then `reconnecting`, and a
  `confirmed` state that shows "Connected" for `CONNECTED_CONFIRMATION_MS` and unmounts. Because
  y-websocket reports `status: 'connected'` as soon as the socket opens, the badge waits for the
  provider's `sync` event, otherwise it would say "Connected" before the board is usable.
- **`StickyTextEditor` accepts remote text while typing**: the editor keeps its own `value`, so a
  remote change to the same note has to come in through `ytext.observe()` or the next diff would
  delete the other person's characters. The caret is moved with the delta (`shiftCaret`) and IME
  composition is left alone.
- **Board switch = new document**: `useBoardDoc(boardId)` tears down provider and doc, and `App`
  keys the board by id, so no state from the previous board survives.

## Test technique (story 3)
- **Integration tests (`--project integration`, `vitest.config.ts` workers pool)** run the real
  Worker and real Durable Objects through `cloudflare:test`'s `SELF`. Clients come from the upgrade
  *response*'s `webSocket` (`response.webSocket.accept()`), which is how workerd hands a connection
  to a caller - the pair inside the room is the other half. Frames are re-implemented in
  `tests/integration/ws-client.ts` on purpose: the client must not share the room's decoder, and it
  mirrors `y-websocket` byte for byte (SyncStep1 on open, answer SyncStep1 with SyncStep2, relay
  awareness, mark remote origins so a change is never echoed back).
- **A fresh room is simulated** with a second Durable Object `idFromName` for the same board name
  (`connectToStub`), which is what a restart does; TC-18 and the live catch-up test use it.
- **Component tests fake only the wire**: `tests/component/fakeSocket.ts` is a scripted `WebSocket`
  injected through the provider's `WebSocketPolyfill` option, so `WebsocketProvider`, y-protocols
  and Yjs are the real ones and TC-19 to TC-21 (badge states, the `CONNECTED_CONFIRMATION_MS`
  window, dropping again during it) are driven by `open()` / `close()` / `syncWith(roomDoc)` under
  fake timers. `vi.advanceTimersByTime` runs inside `act()`, and the provider's backoff is waited
  out with the real `RECONNECT_MAX_BACKOFF_MS` before the next attempt exists.
- **Latency is measured, not asserted, in e2e** (per the story's own note): the e2e helpers log the
  observed p50/p95/max for every propagation, while the integration tests assert the same thing
  within `LIVE_UPDATE_LATENCY_BUDGET_MS`, where the timing is under our control.
- **Convergence is checked three ways**: equal state vectors, equal rendered notes (what the user
  sees), and - for the random-operations soak - equal note sets after 30 rounds of concurrent
  mutation, so a mutation type that never reaches the other side cannot slip through. The browser
  side reads the state vector through `window.__vidi6.stateVector()`, which is in the test build
  only (`vite build --mode test`, what `npm run test:e2e` serves).
- **The badge is read by `data-testid="connection-status"`** in e2e, because `role="status"` also
  matches the zoom readout and the board's own hint.
- **Each participant in e2e gets a part of the world** (`spreadOut`, cameras 3000 units apart) so a
  drag always grabs the note its owner means to, and their notes cannot overlap each other's.
  Overlap matters in the soak because every edit is a click: a buried note cannot be selected.
- **The soak measures one watcher per change** - "the watcher sees exactly what the author sees", all
  fields of the snapshot, so a keystroke in a note too long to display in full still counts as
  arrived - and then asserts the whole group agrees. An edit that could not be made at all (no free
  slot, nothing to edit) measures as 0 ms rather than failing: it is not a change that went missing.
- **`test.use({ actionTimeout: 10_000 })`** in the live-collaboration spec: Playwright's default
  action timeout is *no timeout*, and a click waiting for an element that will never appear looked
  exactly like a slow board.
- **Nightly scenarios are the `@nightly` title tag**: `npm run test:e2e` skips them and
  `npm run test:e2e:nightly` runs only those, with one worker so the latency report is not measuring
  two suites competing for the machine. `VIDI6_SOAK_MS` shortens the soak while the soak itself is
  being worked on; the default is the 60 s the design names.
