# Story 1 notes — decisions and deviations

## Decisions

1. **Camera convention** (as designed): `camera.x, y` is the world coordinate shown
   at the top-left of the board area, `zoom` is screen pixels per world unit, so
   `screen = (world - camera.xy) * zoom` and `world = screen / zoom + camera.xy`.
   `resetCamera(viewport)` is therefore `{ x: -width/2, y: -height/2, zoom: 1 }`,
   which puts world (0, 0) — the board's starting point — in the middle.

2. **`CameraProvider` lives in `useCamera.ts`.** The design's contract is a
   `useCamera(viewport)` hook that owns the camera, but `BoardViewport`,
   `ZoomControls` and `NavigationHint` are siblings and must share one camera.
   Instead of hoisting state into `App` (which would mean passing the whole
   controller down by props and re-creating it per render), `useCamera(viewport)`
   is implemented exactly as documented and `CameraProvider` is a thin wrapper
   that calls it, measures its own `.board-area` element with a `ResizeObserver`
   and publishes the controller through context (`useCameraContext()`). Only
   story 1's three components read that context.

3. **Two extra controller members.** `zoomAtPoint(point, factor)` — Safari's
   `gesturechange` reports a cumulative `scale`, so the handler needs to apply an
   incremental factor at a screen point rather than a wheel-style delta.
   `setCamera` / `getCamera` — used only by the test hook (see 10). Everything
   the design lists (`camera`, `hasNavigated`, `beginPan`, `panMove`, `endPan`,
   `wheel`, `zoomStep`, `reset`) is there with the documented shapes.

4. **Origin marker.** World (0, 0) is drawn as a 16 px crosshair positioned in
   screen space from `worldToScreen(camera, {0, 0})`, so it keeps a constant size
   at every zoom and gives the e2e tests a stable pixel target for "the board's
   starting point" and "a grid dot". It is `pointer-events: none`, so it never
   intercepts a drag. It is the only board content in this story; story 2 puts
   real content in the world layer.

5. **Grid is a CSS background on the input surface**, not an element:
   a `radial-gradient` dot per `GRID_SPACING_WORLD * zoom` tile, with
   `background-position: mod(-x*zoom - spacing/2, spacing)`. Using the background
   (rather than translating a huge painted layer) keeps every offset inside one
   tile, so precision is perfect at `UNBOUNDED_PAN_TESTED_EXTENT`, and the tile
   centre — where the dot is drawn — lands exactly on world multiples of the
   spacing, which is what the dot-attachment tests assert.

6. **Wheel delta units.** `deltaMode === LINE` → `WHEEL_DELTA_LINE_PX` (40 px),
   `PAGE` → `WHEEL_DELTA_PAGE_PX` (800 px), `PIXEL` → as-is; both constants are
   in `src/shared/config.ts`.

7. **Zoom-step snapping.** `zoomStep` snaps the new zoom back onto
   `ZOOM_STEP_FACTOR^n` when it is within `ZOOM_STEP_SNAP_TOLERANCE`
   (relative, 1e-9), so "+ then −" returns exactly 1.0 (TC-09). Pinch/wheel zoom
   is never snapped, so free zooming is unaffected.

8. **`hasNavigated` latches on real navigation only.** The no-op cases return the
   *same* camera object (`panBy` with a zero delta, `zoomAt` that clamps to a
   limit, invalid factors), and the latch flips only when the camera object
   changes — so a click without movement and zooming at a limit leave the hint up
   (TC-29). The initial centring of the view and `Reset view` from an already
   standard view do not dismiss it; any actual reset does (reset always yields a
   new object).

9. **Camera updates are coalesced in a `requestAnimationFrame`**: input handlers
   write the next camera into a ref and schedule one frame commit, so a burst of
   pointermove/wheel events causes at most one render per frame.

10. **Test hook `window.__vidi6`** (`src/client/canvas/testHooks.ts`) is installed
    only under `import.meta.env.MODE === 'test'`. That guard is a build-time
    constant, so `npm run build` dead-code-eliminates it — verified with
    `grep -c "__vidi6" dist/client/assets/*.js` → `0`. E2E uses
    `npm run build:test` (`vite build --mode test`), which contains the hook.
    `setCamera` deliberately does *not* flip `hasNavigated`: teleporting the
    camera in a test is not the user navigating.

## Deviations from the spec

1. **TC-30 mechanism (task 4 said "stop wheel propagation on the control
   container").** The board's wheel listener is attached to the viewport element
   only, and the zoom control and hint are siblings of the viewport inside
   `.board-area`, so a wheel over a control never reaches the board at all. The
   component test asserts the camera is unchanged *and* that
   `event.defaultPrevented === false` there — the board does not swallow events
   outside itself.

2. **E2E runs in Chromium only on this machine**; Firefox and WebKit projects are
   configured but skipped (see "Blocked" below).

3. **Ports.** `vite dev` 21328, `vite preview` 21329, `wrangler dev` 21330 (with
   `--inspector-port 21331`) — Playwright's `webServer` starts
   `npm run build:test && wrangler dev` on those ports instead of wrangler's
   default 8787, because only 21328–21343 are allocated to this machine. All are
   `--strictPort`, so a busy port fails loudly rather than drifting.

4. **`wrangler.jsonc` has no assets `binding`.** Wrangler 4 refuses to serve an
   assets-only Worker that declares an assets binding ("Cannot use assets with a
   binding in an assets-only Worker"). The binding arrives together with `main`
   in story 3.

5. **Extra named constants** in `src/shared/config.ts`, beyond the six in the
   design: `PERCENT_PER_ZOOM`, `ZOOM_STEP_SNAP_TOLERANCE`, `WHEEL_DELTA_LINE_PX`,
   `WHEEL_DELTA_PAGE_PX`, `GRID_DOT_RADIUS_PX`, `ORIGIN_MARKER_SIZE_PX`. They keep
   the "no magic literals in components" rule honest.

6. **Extra test-support files**: `tests/component/harness.tsx` (jsdom geometry,
   tracked `ResizeObserver` stub, rAF flush, pointer/wheel/gesture/keyboard
   dispatchers) and `tests/e2e/helpers/board.ts`. `useCamera` is exercised through
   the rendered board rather than a separate hook-test file, which is how its
   behaviour is actually observed.

7. **Layout wrapper.** `App` renders a fixed, full-window `.board-area` (the
   element the viewport size is measured from) containing the viewport plus the
   overlay zoom control and hint. The design only said "App mounts BoardViewport
   full-window".

8. **Component tests stub the environment** (jsdom has no layout, no pointer
   capture and no GestureEvent): every element reports a 1280x800 board area,
   `setPointerCapture` is optional in the handler (`typeof` check, so real
   browsers use it), and TC-17 synthesises a Safari-like `gesturechange`.
   TC-07's "UI level" case resizes the board area through the tracked observer.

## Blocked

**E2E in Firefox and WebKit cannot run on this machine.** Both need GTK:
`ldconfig -p | grep libgtk-3` returns nothing, `sudo` is refused
(`no new privileges`), and `apt-get install libgtk-3-0t64` reports the package is
not available. The browser builds themselves are present
(`PLAYWRIGHT_BROWSERS_PATH=/w/browsers`: chromium-1243, firefox-1543, webkit-2359)
but Firefox and WebKit fail to launch with "Host system is missing dependencies".

`playwright.config.ts` therefore filters those two projects out at load time and
prints `[e2e] skipping firefox and webkit: this host has no GTK libraries`; on a
host with GTK the same command runs all three. Nothing in the implementation is
Chromium-specific: the input paths use the standard Pointer Events, Wheel Events
(with `{ passive: false }`) and Safari `gesture*` listeners, and the
Safari-only gesture handler that Playwright cannot synthesise is covered by
component test TC-17.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 24 passed (TC-01…TC-12 + 1000-case pointer-invariance property check) |
| `npm run test:component` | 30 passed (TC-13…TC-22, TC-29, TC-30, TC-32) |
| `npm run test:e2e` | 8 passed in chromium (TC-23…TC-28, TC-31, three workflows); firefox/webkit skipped |
| `npx playwright test --repeat-each=2` | 16 passed, no flakes |
| `npm run build` | succeeds; `grep -c __vidi6 dist/client/assets/*.js` → 0 |
| `npm run build:test` | succeeds; test hook present in the bundle |
| `npm run dev` (21328) / `npm run preview` (21329) | both serve the board |

---

# Story 2 notes — decisions and deviations

## Decisions

1. **One `Y.Map` of objects, one `Y.Text` each** (`src/shared/board-model.ts`).
   A note record holds `id`, `shape`, `x`, `y`, `z`, `color` as plain values and
   `text` as a `Y.Text`, so two people typing into the same note merge without a
   last-write-wins fight, while moving and recolouring stay single-value sets.
   `snapshot()` sorts by `z` then `id`, which is the order the notes are rendered
   in, so DOM order, document order and stacking order are the same order.

2. **Local edits are tagged with an origin** (`LOCAL_ORIGIN`). Nothing reads it
   yet; story 8's undo needs to tell our own changes from somebody else's, and
   tagging at the source is the only place that knowledge exists. Every mutator
   runs inside one transaction, so one user gesture is one update.

3. **Mutators answer `true`/`false` and emit nothing when the answer is false** —
   a stale id, a non-finite position, an unknown colour, a no-op. Tests assert the
   `update` event count (1 for a real change, 0 for a rejection), which is what
   story 3's traffic depends on.

4. **`useBoardDoc(provided?)` and `App`'s optional `doc` prop.** Story 3 hands
   them the document it syncs with the room. Component tests hand them a private
   `Y.Doc` and then read `snapshot(doc)` — so they assert on what the board stored,
   not on a rendering of it. Without an argument both make a fresh in-memory doc,
   as before.

5. **Auto-fit is measured by the note, not by the editor.** `StickyNote` keeps a
   hidden layer with the visible text's width, wrapping and line height;
   `fitFontSize(element, box)` binary-searches integer sizes and asks that layer
   whether the text is taller than the note gives it. The result drives the display
   layer, the textarea and the fade together, so typing feels like the text that is
   already there, and `StickyTextEditor` never changes its own box (design 4.4).
   `fitFontSize` takes the element as a *probe*, so the same search answers both
   questions: the largest size that fits, and whether even the smallest does not.

6. **Text edits are written as one delete plus one insert of the difference**
   (`applyTextDiff`), with the common prefix and suffix left alone. A concurrent
   change elsewhere in the same note then still merges (TC-38's basis; story 3 is
   where two people actually type at once).

7. **The note root is the drag target**; the text layer and the editor layer
   `pointer-events: none` except while typing. A click on the words therefore
   selects and drags the note, the note's `getBoundingClientRect()` stays the hit
   area, and the caret works the moment the note is being edited.

8. **Drag deltas are measured against the pointer's start and divided by `zoom`**,
   not accumulated from `movementX`: `movementX` is in device pixels, so it is
   fractional under browser zoom and integer-truncated in Chromium, which would
   make a note drift on a long drag. The commit is rAF-coalesced and written to the
   document on pointerup only, so a two hundred move drag is one update.

9. **A dragged note is raised only if it ends up overlapping another one**, at the
   end of the drag rather than the start: a move that does not need a new stacking
   order does not cause a document change or a DOM reorder mid-gesture.

10. **The note toolbar is a child of the note**, counter-scaled by `1 / zoom` with
    `transform-origin: 50% 100%` — the gap above the note is in world units and
    scales, the toolbar itself does not (verified in e2e at 50 %, 100 % and 200 %).
    The note root therefore does not clip with `overflow: hidden`: the text and
    edit layers inside it clip instead (see deviation 3).

11. **`window.__vidi6.getBoard()`** returns `snapshot(doc)`, so e2e asserts on
    stored positions and text rather than guessing them from the screen. Test hooks
    are now registered piecewise (`registerTestHooks`) because the viewport owns the
    camera half and the board owns the content half; still `MODE === 'test'` only,
    still tree-shaken out of `npm run build`.

## Deviations

1. **`STICKY_FADE_HEIGHT_PX` is named `STICKY_FADE_HEIGHT_WORLD`.** The design's
   setting text calls it a pixel height, but the design's own behaviour is that the
   fade scales with the note — it is a world-unit length. The name says which.

2. **`CameraControls` exposes `viewport`.** The sticky tool creates a note in the
   middle of whatever is on screen, and `App` works that out; only the camera hook
   knows the measured size of the board area. Nothing else about story 1's contract
   changed.

3. **`overflow: hidden` moved from the note to its text layers.** With it on the
   note, the note's own toolbar — which sits above the note's top edge — is clipped
   away and unclickable. AC-15 is about text not leaving the note, and clipping the
   two layers that hold text does exactly that while keeping the toolbar visible.

4. **A note is a `div` with `role="group"`, `tabIndex={0}` and an `aria-label`**, not
   a real `<button>`: it has to contain a textarea and a toolbar, which do not
   belong inside a button. Selection is drawn with an outline (`--note-selection`)
   rather than the focus ring, because a note is selected by pointing at it and
   focused in order to be moved or deleted — the two are not the same thing.

5. **`BoardViewport` gained `doc`, `onStickyCreated` and `onEmptyClick`.** The
   design puts double-click-to-create in the viewport and selection in `App`, so the
   viewport reports the fact and `App` decides what it means (create a note there
   and edit it; clear the selection). The viewport still knows nothing about notes.

6. **The overflow fade can only be verified in a browser.** jsdom performs no text
   layout — `scrollHeight` is always 0 — so the fade, the shrinking font and
   "nothing is drawn outside the note" are e2e (TC-33, TC-34). The part of the rule
   that is pure logic, the search between the two configured sizes, is unit-tested
   with a fake measurer (TC-33's range, `fitFontSize` never leaves `[min, max]`).

7. **File names.** The design mentions `tests/component/StickyTextEditor.test.tsx`;
   the typing tests live in `tests/component/StickyTextEditing.test.tsx` because
   they drive the whole app (double-click to open, click away to close) rather than
   the editor in isolation, which is how the behaviour is actually observed.
   `tests/component/harness.tsx` grew the note helpers (`fireInput`, `firePaste`,
   `fireComposition`, `flushFrames`, note and toolbar locators) and
   `tests/e2e/helpers/board.ts` grew `getBoard`, the note locators and `dragNote`.

8. **The IME case is driven by dispatching the composition events in the page**,
   in the order and with the values an input method really sends
   (`compositionstart`, provisional inputs, `compositionend`, final input):
   headless Chromium has no keyboard layout or input method to drive. The paste
   limit uses `keyboard.insertText`, which arrives as a single `input` event,
   exactly as a paste does. Both are e2e; the same paths are covered in jsdom by
   `fireComposition` and `firePaste`.

## Blocked

Nothing new. E2E still runs in Chromium only on this machine (story 1's note about
missing GTK applies unchanged); nothing in this story is Chromium-specific — the
interaction uses standard Pointer Events, and the one browser-only behaviour it
depends on, text measurement, is asserted in Chromium and unit-tested everywhere.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 81 passed — 33 board model (TC-01…TC-12, TC-39), 24 sticky text (TC-13…TC-17), 24 story 1 camera |
| `npm run test:component` | 67 passed — 37 new (TC-18…TC-32, TC-34…TC-37) plus story 1's 30 |
| `npm run test:e2e` | 32 passed in chromium — 24 new (TC-16, TC-20, TC-21, TC-23, TC-25, TC-27…TC-29, TC-31…TC-38) plus story 1's 8 |
| `npx playwright test --repeat-each=2` | 64 passed, no flakes |
| `npm run build` | succeeds; `grep -rc "__vidi6" dist/client/assets` → 0 |
| `npm run build:test` | succeeds; test hook present in the bundle |

---

# Story 3 notes — decisions and deviations

## Decisions

1. **A binary WebSocket frame arrives as a `Blob` on the platform.** The first
   end-to-end run showed every connection closing 1003 "Unexpected end of array":
   `MessageEvent.data` is an `ArrayBuffer` in most runtimes but a `Blob` in workerd,
   and `new Uint8Array(blob)` silently produces an empty array. `frameBytes()`
   (`src/shared/protocol.ts`) normalises `Blob` / `ArrayBuffer` / `Uint8Array` and
   returns `null` for anything that is not binary, so `decodeMessage` only ever
   sees bytes. `BoardRoom.handleMessage` is `async` because a `Blob`'s bytes are
   only available asynchronously; the `message` listener itself is not, and it
   `.catch()`es, because an unhandled rejection inside a listener is how a socket
   gets dropped badly.

2. **A broadcast update is written with `syncProtocol.writeUpdate`, not by hand.**
   The sync frame is `varuint(MESSAGE_SYNC)` + `varuint(2)` + `varuint(len)` + the
   update. Writing `writeUint8Array(update)` after the frame type (which reads
   naturally) produces something a peer cannot apply — same symptom as above,
   "Unexpected end of array", but thrown inside the browser's Yjs message handler.
   Using the `y-protocols` writer for every sync message (`writeSyncStep1`,
   `writeUpdate`) means the room and the provider cannot drift apart.

3. **The connection state machine is a plain function.** `createConnectionMachine`
   in `src/client/sync/connectBoard.ts` holds the state diagram and
   `attachConnectionMachine(machine, provider)` wires it to a provider's `status`
   and `sync` events. TC-19 to TC-21 drive that seam with a fake emitter and fake
   timers instead of a real socket, and `connectBoard` is the ten lines that put
   the two together with `WebsocketProvider`. Two details of the real provider
   shaped it: `status: 'connected'` fires on socket open, *before* the documents
   agree, so `connected` waits for `sync: true`; and a provider that never synced
   is still `connecting`, not `reconnecting` — nothing was lost.

4. **`disableBc: true`.** With `y-websocket`'s BroadcastChannel left on, two tabs
   of the same browser sync without the server and every multi-tab test would pass
   against a broken room. The story is about the server path, so the shortcut is off.

5. **No provider without a board id.** `useBoardDoc({ boardId, doc })` and `App`'s
   `doc` prop: a document handed in by a component test is never put on the
   network, and reports `connection: 'connected'` so the badge stays out of those
   tests. `App` reads the board id from the URL only when it was not given a
   document, so jsdom never tries to open a socket.

6. **`/b/:boardId` is resolved during render, not in an effect.** Writing the fresh
   id with `history.replaceState` is idempotent — the second render of a StrictMode
   double render reads back the address the first one wrote — and it means the
   board id is available on the very first render, which is when the provider needs
   it. Story 5 replaces this with a server-side "new board" answer.

7. **`window.__vidi6.connectionState` is a getter**, not a value written at
   registration, so a Playwright poll always reads the current state;
   `reportConnectionState(connection)` is called from an effect in `App`.

8. **A note that disappears ends the edit quietly** (`useSelection` via `App`'s
   effect on `notes`): `endEdit('unselected')` when `editingId` is gone, otherwise
   `select(null)` when `selectedId` is gone. Somebody else deleting the note you
   are typing in shows no dialog and no error, per `live.delete_during_edit`.

9. **The room is deliberately not a hibernating WebSocket server.** Every socket is
   kept in a `Set` with `accept()`; the doc lives in memory. Hibernation pays for
   idle sockets, which story 4 (persistence) and the nightly idle test interact
   with, and it would mean serialising state through `serializeAttachment` for no
   benefit in this story.

## Task 6 — merging, broadcast and bad traffic in workerd

`tests/integration/board-room.test.ts` runs against the real room with real sockets
(`tests/integration/helpers/ws-client.ts`) and the real `board-model` mutators. Things
worth remembering, all learned the hard way:

1. **A test client must never be the origin of its own transaction.** `TestClient`
   relays every `update` whose origin is not itself — that is how an applied remote
   update avoids going straight back out. The random-ops helper first passed the
   client object as the origin of a typed insert, so those updates never left the
   document: five clients "never converged", and it looked exactly like the room
   losing messages. Use any other origin (`'typed-here'`) for edits a test makes.

2. **When clients disagree, ask the room.** A client that has just finished its
   first sync holds the room's own document, so a newcomer is the cheap way to see
   what the room merged; if the newcomer is missing content the room never applied
   it, and only then is it worth looking at the broadcast. Reaching the room's own
   answer (`BoardRoom.fetch` on a non-upgrade request) needs
   `env.BOARD_ROOM.get(id).fetch(...)`, because the Worker replies 426 to a plain
   GET before the room ever sees it.

3. **Yjs does not report undecodable updates unless asked.** `readSyncMessage` /
   `readUpdate` catch everything an `applyUpdate` throws and only `console.error` it,
   with no rethrow when no `errorHandler` is passed. The design's "an update Yjs
   cannot apply closes only that socket" therefore needs BoardRoom to hand it
   `(error) => { throw error }` and close 1003 in its own catch. Without that the
   room silently absorbs nonsense, which is the wrong answer twice over: the sender
   never learns, and the next test wonders where its content went.

4. **Copy the bytes of a received frame before doing anything async.**
   `frameBytes` (`src/shared/protocol.ts`) always returns a copy of its own: a
   `Uint8Array` handed to a message handler can be a view onto a buffer the runtime
   reuses for the *next* message, and a Blob has to be read asynchronously, so a
   frame still waiting in the queue can otherwise have its contents replaced. That
   failure has no error anywhere — content simply never arrives.

5. **A restarted room is what an empty room looks like.** Nothing is persisted in
   this story, so TC-18 simulates a restart by joining a brand new board id with the
   returning client's own document: an in-memory doc that holds nothing and one
   person to rebuild it from. A real eviction mid-test could not be arranged on
   demand, and pretending otherwise would have meant testing story 4's persistence.

6. **A peer that vanishes is created by closing without warning** (`closeNow`), then
   writing immediately: the room still holds the dead socket when the next broadcast
   runs, which is the situation TC-31 is about. `sendTo` dropping an unwritable
   socket from the set instead of throwing is what the test pins down.

7. **Keep new imports out of the Durable Object module for now.** Importing
   `isValidBoardId` into `board-room.ts` built fine and threw
   `isValidBoardId is not defined` at runtime under vitest-pool-workers, while the
   same import in the Worker entry works. BoardRoom does not need it (the Worker
   validates the id before routing), and the room's status answer decodes the id from
   the forwarded URL instead. Re-check this if a later story needs shared code inside
   the room.

## Task 7 — the badge in jsdom

`tests/component/ConnectionStatus.test.tsx` covers TC-19 to TC-21, the
`role="status"` requirement and the negative case (nothing on the board is locked
while the badge says "Reconnecting…").

1. **Fake `connectBoard`, not `WebSocket`.** `vi.mock` on the sync module replaces
   only the socket half and keeps the real `createConnectionMachine` and
   `attachConnectionMachine`, so the state mapping the badge depends on stays under
   test; the fake provides `on`/`off` plus `status()`/`sync()` for the test to pull.
   `vi.hoisted` holds the fake provider class, because a `vi.mock` factory runs
   before the module's own imports.

2. **A provider event has to arrive inside `act()`.** `status` and `sync` come from
   outside React; called bare they update the machine but not the DOM before the
   next assertion, and the only clue is a warning. The test's `sayStatus`/`saySync`
   helpers exist for that reason, and `tick()` wraps `advanceTimersByTime` the same
   way — TC-20's boundary (visible at `CONNECTED_CONFIRMATION_MS − 1`, gone at
   exactly `CONNECTED_CONFIRMATION_MS`) is only meaningful with fake timers that
   React is told about.

3. **`role="status"` is already taken by the zoom readout.** The zoom percentage is
   an `<output>`, whose implicit role is `status`, so `getByRole('status')` on the
   board screen finds two elements. Assert the badge's own `role` attribute and
   leave the query alone.

4. **Put the address in the history before rendering `App`, with an id that is
   actually valid.** `boardIdFromLocation` mints a fresh id when the path does not
   carry one that passes `BOARD_ID_PATTERN` (22 characters exactly), so a test that
   types a sloppy id ends up joined to a different board than the one it is
   asserting on.

## Task 8 — two browsers, one board

`tests/e2e/live-collaboration.spec.ts` covers TC-22 to TC-28; the machinery lives in
`tests/e2e/helpers/participants.ts`.

1. **Typing into a note had to learn about remote edits before e2e could prove it.**
   `StickyTextEditor` keeps the textarea uncontrolled, so a change arriving from
   somebody else never touched it — and the next local keystroke wrote the whole
   stale buffer back, deleting what the other person had just typed. TC-23 is the
   test that found this: it passed a character-count assertion only after
   `StickyTextEditor` grew an observer that pours the incoming `Y.Text` into the
   textarea and carries the caret across the insert with `mapCaret`
   (`src/client/objects/StickyText.ts`). Two details that are easy to get wrong:
   the observer must be skipped while an IME composition is open, and a Yjs delta
   omits trailing retains, so `mapCaret` cannot know the new length — the caller
   clamps.

2. **One context per person, always.** `browser.newContext()` is what makes two
   people of the same board: same browser, separate storage, separate sockets. Any
   test that opened two tabs in one context would quietly be testing one person.

3. **`setOffline` does not break a WebSocket.** Chromium's offline emulation stops
   new requests; an established socket carries on, so TC-27 as first written never
   left the "connected" state. An outage has to be started where the connection
   lives: a test-only `dropConnection` hook closes the provider's socket, and CDP
   `Fetch.failRequest` on `*/api/rooms/*` refuses the reconnection handshakes for as
   long as the outage lasts. `takeLinkAway()` returns the restore, because a test
   that leaves the network intercepted confuses every test after it.

4. **Latency is printed, never asserted, and printing it is worth doing anyway.**
   Every wait goes through `eventually()`, which reports how long the change took
   against `LIVE_UPDATE_LATENCY_BUDGET_MS`. On this machine the numbers are single
   digit milliseconds; a budget assertion here would only measure what else was
   running.

5. **Concurrent work is asserted as convergence, not as a winner.** TC-24 drags the
   same note from both browsers at once and asserts that both boards end up on one
   position that is not where they started. Which drag won is decided by Yjs clock
   ordering, and a test that pinned that down would be testing Yjs.

6. **At capacity, give each editor their own part of the board.** Five editors at the
   same camera would double-click on each other's notes. Offsetting each camera by
   4000 world units in x (TC-26, and the same in the nightly soak) means every
   screen point in the test refers to a different patch of empty board per person.
   Chromium only: the merge behaviour being proven is browser-independent, and five
   contexts times three engines buys nothing.

7. **`reuseExistingServer` reuses the build too.** Playwright only runs
   `npm run build:test` when it starts the server, so after changing client code
   kill the `wrangler`/`workerd` processes first — otherwise the browser is testing
   yesterday's bundle. (`npm run build` for the integration tests overwrites
   `dist/client` with a production build, which has the test hooks tree-shaken out.)

## Task 9 — the nightly run

`tests/e2e/live-stability.nightly.spec.ts`, run by `npm run test:e2e:nightly`.

1. **A Playwright project of its own, plus a tag, not an environment variable.** The
   nightly cases live in `*.nightly.spec.ts`; the three ordinary projects `testIgnore`
   that pattern and a fourth (`nightly`, chromium only — the sync client and the room
   are what is being proven, not a browser engine) `testMatch`es it. That alone was
   not enough: a plain `playwright test` runs *every* project, and the first full run
   sat through both soaks (41 tests, not 39). The tests are therefore also tagged
   `@nightly` and `npm run test:e2e` passes `--grep-invert @nightly`.
   `npm run test:e2e:nightly` selects the project, so it stays chromium-only even on
   a host that can run three engines.

2. **Watch an idle connection from inside the page.** TC-29 samples
   `window.__vidi6.connectionState` and the badge text every 250 ms *in the page* and
   reads the list back at the end; polled from the test driver, a slip lasting a
   second could fall between two round trips and be reported as a steady
   connection. The idle period is longer than `RECONNECT_MAX_BACKOFF_MS` and longer
   than the provider's ping interval, so a link that only holds at first is still
   caught — and the test makes one edit afterwards, because "never left `connected`"
   would also be satisfied by a connection that stopped sending.

3. **The soak's first failure was about reach, not randomness.** It died with
   `element is outside of the viewport`: `boardOf` returns the whole shared board,
   and at capacity almost all of it is off any one person's screen. Choosing only the
   notes whose centre lands inside that person's viewport (`onScreen`) is what made
   it a test of editing rather than of scrolling. Related: `actionTimeout` is now set
   in the Playwright config, because a click waiting on an unreachable element
   otherwise says nothing for the entire test timeout — that is how the first run
   spent five minutes before failing.

4. **Notes are kept near the slot they were made in.** Eight slots, spaced further
   apart than a note is wide, and a move clamped to `DRIFT` units from the note's own
   slot. Without that, random walks let notes drift on top of one another and a click
   aimed at one hits whichever is on top — a failure that looks like a sync bug and is
   really a test that clicked the wrong thing.

5. **Convergence per change is the assertion; the latency numbers are the report.**
   After each operation the driver waits until every other board serialises to
   exactly what the editor's board holds (documents, not pixels), with the ordinary
   functional timeout — that is a real failure. It times the wait on the way past,
   and prints p50/p95/max with the seed and the three slowest operations. A failure
   prints the seed and the last thirty operations, without which a random soak is
   unreproducible. On this machine: 816 changes in 60 s at five editors, p50 11 ms,
   p95 21 ms, max 30 ms.

6. **The generator moved to `tests/helpers/random.ts`** so a seed means the same run
   in the workerd soak and the browser soak. It could not simply be imported from
   `tests/integration/helpers/random-ops.ts`, which pulls in `cloudflare:test`.

7. **What "no reconnect after close" can honestly mean here.** The test closes four
   of the five contexts, waits longer than the reconnect backoff, and asserts the
   board left behind is still `connected` and that none of the closed ones logged
   anything on the way out. It cannot read a log from a page that no longer exists;
   what it can show is that closing one board neither disturbs the others nor leaves
   something retrying.

---

# Story 4 notes — decisions and deviations

## Task 2 — the board store

1. **A damaged row is survived by rebuilding the log, not by carrying on.** The
   design's `load` applies row after row and moves a row that throws to quarantine.
   Doing that in a single pass leaves the live document missing the hole *and*
   everything that was built on top of it, silently, and the caller cannot tell how
   much went. So `load` replays into its own `Y.Doc`: the first row that throws ends
   that attempt, the row is quarantined, and the whole log (minus the quarantined
   rows) is replayed again from scratch, until a pass finishes clean. Only then is
   the caller's document touched, and only with a complete state. A half-read board
   is never handed to anyone, and `quarantined` counts rows, which is what the design
   promises — not a claim that nothing else is missing (see 5).
   `transactionSync` cannot help across rows: an outer transaction's writes are
   discarded when the callback throws, so a `transactionSync` per row does not make
   the *document* rollback-able. That is exactly what the injection seam shows: with a
   forced mid-compaction failure the old chunks, the log and the pointer are all
   unchanged.

2. **`load` builds its own doc; the room passes an empty one.** The contract stays
   `load(doc)`, but because the replay is into a temporary doc the room's document is
   only ever advanced by one `applyUpdate` of the finished state. It also means the
   `LOAD_ORIGIN` transaction is one transaction rather than hundreds, which is what
   the client's first render wants.

3. **Everything SQLite hands back is copied out** (`toBytes`), because the
   `ArrayBuffer` from `sql.exec(...).one()` belongs to the statement; the buffer is
   still needed after the row cursor moves on, and quarantine writes it back verbatim.

4. **Two bounds, deliberately.** Compaction records `snapshot_through_seq = max(seq)`
   and deletes exactly `seq <= snapshot_through_seq`; a damaged row's id is excluded
   from that max, because its bytes no longer stand for a change and the replay skips
   it. Load reads `seq > snapshot_through_seq` (strictly) for the tail and
   `seq < snapshot_through_seq` for the replay, so a row whose bytes went bad *after*
   being folded into a snapshot is quarantined without removing it from the log — the
   quarantine table is the copy that leaves the log, and the log stays the source of
   truth for `MAX(seq)` (TC-11). Quarantine never deletes content, which is why
   TC-10's byte check counts quarantine rows rather than trusting a row count.

5. **The boundary of "the rest of the board loads" is Yjs', not ours.** With one
   unreadable row, the notes that go missing are that change plus the changes whose
   CRDT items were built on top of it: on the retro fixture (6 authors, real
   mutators) that measured 4 of 23, and applying the log a second and third time
   recovers nothing, so it is genuine dependency and not an artefact of the order we
   apply in. Nothing in a log-with-a-hole can do better — TC-09 therefore asserts
   equality with a *reference replay* (the same log with that row absent, applied once
   by the test), which is the best any loader can reach, plus "more than half the
   board is there", "nothing appeared that was never there" and "exactly one row was
   reported unreadable".

6. **`shouldCompact` is count *or* bytes, and a full board is neither.** 2,000 notes
   arriving in 25-note batches is 82 rows and a 779 KB log: no compaction. That is the
   point — the thresholds are about write amplification, not board size. The chunking
   test therefore pads the log with `COMPACTION_UPDATE_COUNT` moves and asserts on how
   the 600 KB snapshot is stored, which is the thing under test (TC-08).

## Task 3 — store tests against real Durable Object SQLite

1. **The fixture plays a session, it does not just build a document.** `retroBoard()`
   returns the room's state *and* the ordered log of updates as separate authors sent
   them, because a document and a log are different things and every damage test needs
   the latter. Authors are separate `Y.Doc`s with their own client ids, each synced
   from the room before it edits; one client driving 2000 notes would make a single
   lost row swallow half the board (see 5 above) and turn a story about one bad row
   into a story about a missing half.

2. **`tests/fixtures/boards.ts` uses only real mutators** (`createSticky`, `moveSticky`,
   `setStickyColor`, `deleteSticky`, `applyTextDiff`) through one `doc.transact`, which
   is what `board-room`'s clients cause; nothing hand-writes Yjs structures, so the
   bytes being damaged are the bytes the app really stores.

3. **`sqlite_sequence` exists.** `id INTEGER PRIMARY KEY AUTOINCREMENT` makes SQLite
   create it, so a test that asserts "the schema is these four tables" has to ignore
   `sqlite_%` — the alternative is a schema without AUTOINCREMENT, which is a worse
   schema.

4. **A test that wants a row to fail must make it fail for the right reason.**
   `truncatedBytes(update)` cuts the last 10 bytes (a short message is a *valid*
   message, so very short updates are left alone), `randomBytesLike(update)` overwrites
   the middle with same-length pseudo-random bytes, and both are checked against
   "Yjs throws on this" in a unit test. TC-25 asserts a 16-byte header-shaped
   nonsense row is quarantined too.

5. **Everything that touches storage goes through `runInDurableObject`**, one board id
   per test (`inBoard`), and only plain data is returned across the boundary — the
   Y.Docs stay on the outside, and the bytes of a document come back as
   `Array.from(...)` where a test needs them.

## Task 4 — the room keeps the board

1. **The sockets hibernate, and hibernation changes who closes what.** Story 3 used
   `addEventListener` on the server socket, where the platform echoes a close back
   automatically. With `ctx.acceptWebSocket` it does not: `webSocketClose` has to
   answer with a close of its own, or a client that was closed by the room sits in
   "connecting" until it times out. Story 3's TC-07 was the proof — it failed with the
   *second* client never seeing a close, and passed the moment the echo was written by
   hand.

2. **`echoCode` maps 1005 and 1006 to 1000.** Those two codes describe a connection
   that ended without a status; RFC 6455 forbids sending them, and `socket.close(1005)`
   throws — inside `webSocketClose`, which would then leave the socket half-closed. The
   room's own codes (4500, 1011, 1003) are echoed unchanged.

3. **`recordThenBroadcast` is the only place a change leaves the room.** A doc update
   whose origin is `LOAD_ORIGIN` is the room reading its own board, and is skipped; a
   change that could not be appended is not broadcast, and the room then closes every
   socket with 1011 and drops the document — it cannot promise to save the next change
   either, and a board that is silently unwritten is worse than a board that says so.
   An update Yjs refuses is never stored, because it never becomes a doc update: the
   `errorHandler` handed to `readSyncMessage` re-throws so the frame is the sender's
   protocol error (1003) rather than a swallowed log line.

4. **Two storage failures, two words.** `storageFailure` records whether the last one
   was a *read* or a *write*. It exists because a connection that cannot be served needs
   a close code, and the two cases deserve different ones: a board that cannot be read
   is 4500 ("this board could not be opened", the client's red message and edit lock —
   TC-26), and a board that was open and then could not be written is 1011 ("come back",
   because the person still holds unsaved work). The design's table said storage trouble
   at connect time should be 1011 as well; the story's TC-26 is the contract, and the
   distinction is real, so the room keeps the cause rather than the fact.

5. **The idle alarm makes "idle costs nothing" true in memory as well as compute.** The
   last socket to close sets an alarm `BOARD_IDLE_RELEASE_MS` ahead; when it fires with
   nobody watching, the log is folded and `this.board = null`. The next join wakes the
   room and reads the board from storage. No further alarm is set, so the instance itself
   becomes evictable.

6. **Compaction runs after the broadcast, and loops.** `waitUntil(compact())` per change,
   and `compact()` folds while `compactIfNeeded` says the log is still over the
   threshold — one fold per burst would let a busy board defer folding indefinitely,
   because each change that arrives during a fold is a new row. A single `compacting`
   promise keeps two folds from racing, and the `compacting` state is visible in the
   status endpoint.

7. **The attachment on a socket is written but not read.** `{ kind: 'board' }` is stored
   before `acceptWebSocket` so that the story which puts names and cursors on the board
   has somewhere to put them; awareness stays a verbatim relay, as in story 3.

## Task 5 — the tests that a restart really happened

1. **`evictDurableObject` from `cloudflare:test` is the story's test tool.** It tears the
   instance down, keeps the storage, and by default leaves hibernating sockets alive —
   which is TC-13 (reopen after a restart nobody watched) and TC-18 (the rebuilt room
   delivering to sockets it never accepted, asserted by `clients: 2` in the status of an
   instance that was not there when either socket was opened). It works with no sockets
   open, and it rejects if the object is not running, so a test that wants the
   "nobody watching" case has to leave the board first.

2. **Breaking storage means breaking something the migration cannot repair.** Dropping
   the `updates` table appeared to work and did not: the next load calls `migrate()`,
   which creates the table again, and the room came back "ready" with an empty board —
   exactly the lie the story is about, reported as a passing test. Damage has to be at
   column level: `DROP COLUMN data` breaks the read (4500, TC-26), `DROP COLUMN bytes`
   breaks the write and nothing else (1011, TC-14). Both restore with `ADD COLUMN`.

3. **Yjs accepts a truncated update.** Damage that halves a snapshot's bytes with zeros
   loads *successfully*, applying what it could decode. The store tests and TC-15
   therefore damage rows with pseudo-random bytes of the same length — the shape storage
   damage actually has — and the byte count kept next to each row is what catches a
   silent truncation later. Recorded here because the first version of TC-15 was a
   passing test of nothing.

4. **Two deliberate seams, both about time.** `retryWindowHasPassed` sets the room's
   `lastFailureAt` to 0 instead of spending `LOAD_RETRY_MIN_INTERVAL_MS` (five seconds)
   waiting to prove that the room refuses a reload *before* the interval and attempts one
   after it; `loads` in the status endpoint is what makes "no reload attempt happened"
   assertable at all. `loads` is worth having with or without the test — it is the number
   that says whether a board is being read once or hammered.

5. **A change is waited for on the other person's screen.** TC-13 compares the board a
   newcomer finds against what the people who left were looking at, so every mutation in
   it is waited for on the *other* client, and the two snapshots are checked against each
   other before anybody disconnects. Checking the author's own copy made the test fail on
   a change that had not crossed the wire yet — a real race, and the kind of false
   failure that gets a test weakened rather than fixed.

## Task 6 — the browser, and a process that is really killed

1. **These specs own their dev server, and `SIGKILL` is the point.** A test of "the process
   forgot everything" cannot share the run's web server (killing it stops every other spec),
   so `helpers/wrangler-process.ts` starts `wrangler dev` on port 21332 with its own
   `--persist-to` directory, and stops it with `SIGKILL` to the *process group* — wrangler
   supervises a worker runtime of its own, and killing only the parent leaves something
   answering on the port, which would turn "the process died" into a test of nothing (the
   same trap as an eviction that keeps sockets alive). Playwright has no per-project way out
   of a global `webServer`, so the shared one still comes up for a run that selects only
   these; it sits there idle.

2. **The helper does not build the client, and says why.** `pretest`/the web server build it
   in `--mode test`, which is the mode carrying `window.__vidi6`. Building it again as a side
   effect of starting a second server would replace those hooks while other specs are loading
   pages from the same `dist/client`. What the helper does instead is fail with a clear
   sentence if the build is missing — otherwise the board serves an empty page and the report
   says the notes disappeared.

3. **Big boards are seeded over the wire, by a second connection, before any browser opens.**
   `helpers/board-writer.ts` is a raw y-websocket client on Node's global `WebSocket`: it
   answers the room's SyncStep1 with its own SyncStep2, and `seedBoard` then polls with a
   *different* connection until the note count matches. Without that confirmation, "the board
   holds 2000 notes" would be an assumption, and every assertion after it would be about the
   seeding rather than about the restart. One detail cost a debugging round: `readSyncMessage`
   expects its decoder positioned *before* the sync-type byte, so the type has to be peeked
   with a second decoder — consuming it first throws inside y-protocols.

4. **What "opens completely" is measured against.** 2000 notes were chosen in the test and
   their intended centres and colours kept, so the assertion is that the opened board *is*
   that list, position and colour and stacking included, and not merely that 2000 elements
   appeared. The DOM is not virtualised (measured: all 2000 note elements are present with
   most of them far off screen), so a DOM count is a fair functional check here.

5. **Reported, not asserted: 2000 notes render in about 1.8 s** from navigation, against
   `BOARD_LOAD_BUDGET_MS` (3000 ms), printed on every run as the story asks. TC-20's second
   budget is the opposite case and is asserted, with a message that blames the test: killing
   the process within a second of a change being visible is this file pulling the plug
   promptly — measured at ~30 ms — and not a claim about the product's speed.

6. **Making 25 notes through the interface needs clear board to double-click on**, because a
   double-click on an existing note edits it instead of making one. The notes are 200 world
   units square, so the test zooms the camera out to 0.45 and uses a 140-pixel lattice:
   25 notes, none touching, all on one screen. An earlier version panned between three
   screens instead and stopped creating notes partway through; a direct probe says the camera
   is honoured (with camera `(-1000, 250, 1)` a double-click at screen (300, 400) stored a
   note at world `(-800, 550)`), so the cause was in that loop rather than in the product, and
   the single-screen version is both simpler and deterministic. Worth knowing before anyone
   spends an afternoon on panning.

7. **`origin` as a parameter rather than a second base URL.** `openBoardAt` and `openSession`
   take an optional origin so a spec can point at these tests' own server. A separate
   Playwright project with its own `baseURL` would have needed its own web server entry, and
   the whole point is that this server is not the run's.

## Task 7 & 8 — the message, and taking the keyboard away

1. **One close code, one new state.** 4500 is the only code that carries a verdict about
   the *board* rather than about the connection, so it gets its own client state instead of
   being folded into `reconnecting`. Retrying is genuinely what happens: y-websocket's
   `defaultShouldReconnect` refuses only 4400-4499, and 4500 is chosen just outside that
   band (see story 4 task 4), which is what lets the badge honestly say "Retrying…".

2. **`connection-close`, and what a `null` means.** The machine needs the code, so it
   listens to y-websocket's `connection-close` event (`CloseEvent | null`). A null close is
   us hanging up — `provider.disconnect()` in a component test's cleanup, for instance — and
   says nothing about the board, so it must not put an apology on screen. That distinction is
   asserted rather than assumed: `providerClose(null)` after a session leaves the person on
   `reconnecting`, and before one leaves them exactly where they were.

3. **A red message does not flinch.** While `load_failed`, `providerStatus` events are
   ignored: a retry's `'connecting'` would otherwise downgrade the honest sentence to a
   spinner every five seconds. Only a sync proves the board loaded, and the first sync goes
   back to no badge at all rather than to the green "synced" flash — no celebration over a
   scare. The mapping (4500 → red, everything else → the usual `reconnecting`) is tested as
   a table, including that a mid-session 4500 is treated the same way: the board we cannot
   read now is the same failure as the board we could not read on arrival.

4. **Editing is off in six places with one boolean.** Create by double-click, the toolbar's
   add-note button, dragging, typing, changing colour, deleting — all consult
   `canEdit(state)`. Selecting still works, and a drag deliberately stays a click so a person
   can look around a board they cannot change. An open text editor is closed when the board
   locks, because a box typing into a document about to be replaced is worse than no box.

5. **`disabled` plus the guard underneath.** The disabled attribute and title are what a
   person reads ("Someone is still working on this board. Editing is off."), and the guards
   are what make it true — a keyboard shortcut and a synthetic click both arrive where a
   mouse cannot. TC-23 is written accordingly: for each of the six, the assertion is that the
   stored document is *byte for byte unchanged*, read back through `window.__vidi6.getBoard()`.
   Spying on `board-model` functions was tried first and is not dependable here: a module that
   imports a named function calls the binding it captured, not the mock.

6. **The red itself is checked in a browser.** jsdom applies no styles, so the component
   tests pin the class and the exact string, and TC-24 compares the badge's computed
   background against the value of `--status-red-background` *resolved in the page* — so the
   test follows a design-token change, and fails only if the badge stops using it.

## Task 9 — a hook to break a board, and a wire that repeats itself

1. **Why a hook at all:** nothing in a browser can reach a DO's SQLite, and the tool that
   could (`evictDurableObject` from `cloudflare:test`, used in task 5) does not exist under
   `wrangler dev`. So the Worker serves `POST /__test/boards/<id>/corrupt-snapshot` and
   `.../repair`, gated on `TEST_HOOKS=1`, which only `playwright.config.ts`'s web server sets.

2. **The gate is on the door, not inside the room.** `index.ts` does not look up a room
   unless the flag is on, so a deployed Worker has no branch to reach; the room has no flag
   check of its own (its `env` is the Worker's, so checking both would mean a test that
   passes the Worker's check and then fails the room's — and a DO's fetch is only reachable
   through the Worker anyway). The integration test is the proof of the claim: in production
   config `GET /__test/...` returns the SPA fallback (HTML, room never looked up) and `POST`
   is refused by the asset handler, while `idFromName` is never called.

3. **The room cannot evict itself, and does not need to.** `ctx.storage.deleteAll()` would
   destroy a board. The hook damages the snapshot in place, closes everyone with 4500, drops
   the document, and then goes through the room's own hibernate → wake → `loadBoard()` path —
   so the refusal comes from the real read code rather than from an `if (test)` answer. Only
   pseudo-random bytes of the same length work here; zero-filled content loads "successfully"
   with half a board (task 2, above), which is exactly why the `bytes` column exists.

4. **A hook taught me the state machine was right.** The first version called
   `failed('load')` while the room was `ready`. That is not an edge in `room-state.ts` — a
   load failure is only reachable from `loading` — and so the room stayed `ready` with no
   document, refusing readers forever with no retry path anywhere. The transition table
   caught a real bug in my test scaffolding by refusing to lie; the hook now uses the same
   lifecycle a waking room uses, which is also why the `loads` counter reaches 2.

5. **One change can cross the wire twice, and story 3's exact-count test was flaky because
   of it.** While checking for regressions, `TC-07`'s `expect(b.updateCount).toBe(1)` failed
   about one run in eight — and reproduced identically with tasks 7-9 stashed, so it was
   already there. The frame trace explains it: a joining client's handshake is
   `SyncStep1 → SyncStep2 → update` and a change made while that exchange is in flight can
   reach the newcomer both as the answer to its own SyncStep1 and as the broadcast
   (`0,2,1,2`). Yjs merges it, so nothing is wrong on the board; what was wrong was the test's
   claim, which was about a wire that had not gone quiet. Fixed with
   `TestClient.waitUntilQuiet()` and a delta, then verified over 120 rounds × 3 changes that
   on a quiet wire the count is exact and nothing echoes back.

6. **`openBoardAt` cannot be used for a board that will not load** — it waits for
   `connected` by design, which is right everywhere else. TC-24 navigates with a plain
   `page.goto` and waits for the badge instead, and marks `window` before the repair so the
   recovery assertion can prove no reload happened.

---

# Story 5 notes — decisions and deviations

## Task 2 — a board has to be made before it can be joined

1. **Existence is read, never assumed.** `BoardStore.existsReadOnly()` looks at `sqlite_master`
   first and then for `storage_meta.created_at` or any row in `updates`/`snapshot_chunks`. The
   table check comes first because a probe of an address nobody used must not be the thing that
   creates it: `load()` now treats missing tables as an empty board instead of running the
   migration, and `migrate()` runs from `initialize()` or lazily before the first `append()`. A
   stranger typing a plausible-looking link costs one `SELECT` and writes nothing (TC-06, TC-09).

2. **Legacy boards have no beginning, and that is a fact about storage, not a bug.** A board
   written by story 2 has updates and no `created_at`, so the row check is what makes its link
   work. Nothing ever calls `initialize()` for such a board: the first person who writes to it
   takes the lazy migration path and the row appears then, which is why TC-31 checks that the
   seeded board is not merely openable but editable, by two people.

3. **A WebSocket to an address nobody made is now refused** (404 on the upgrade, 4004 as the
   close code). This is story 5's whole point applied to the transport, and it reached back into
   stories 3 and 4's scaffolding: those specs used to invent an id and join it, which had always
   been a little untrue. `openSession`, `openBoard` and the seeding socket in
   `persistence.persist.spec.ts` (TC-21) now make a board through `POST /api/boards` first. The
   seeding socket failed first and loudest, and its error — "the socket could not be opened" —
   was the correct behaviour, not a regression.

4. **Malformed ids are 404, not 400** (was 400 in story 3). To somebody holding a bad link there
   is no difference to report, and telling them apart would let a stranger sort addresses into
   "well formed but unclaimed" and "nonsense", which is a little information about who has been
   handed what.

5. **`initialize()` is idempotent in the way that matters**: a second call answers `exists` and
   leaves `created_at` alone (TC-15). Two tabs opening the same link, or a person refreshing
   while a request is in flight, must not restart a board's clock.

## Task 4 — the address, and what happens when nothing answers

6. **`nextBoardPageState` takes a fourth, optional `id`.** The contract's three-argument form
   cannot produce `ready`, because `ready` carries a board id and the check that produced the
   answer is a check *of* an id the caller already has. Passing it in keeps the reducer pure
   rather than making it remember what it was asked about. `initialBoardPageState(id)` uses the
   same argument, and is what `BoardPage` renders before the first check returns — so a board
   whose check is instant never flashes "Opening board…" at all.

7. **`BoardPageResult` is the check's three answers plus `{ kind: 'retry' }`**, the edge the
   design's state diagram has for "the timer fired and nothing changed" (`checking` and
   `unreachable` both loop through it). Without it the diagram's self-edge has no reducer.

8. **The attempt number lives in a ref, not in state.** `unreachable` carries `attempt`, so
   putting it in the state object means a new object on every retry, which re-runs the timer
   effect, which re-arms a timer that had already fired — a retry loop that never waits. The ref
   is read when a result arrives and is the only place the count is kept (TC-21 counts the calls
   and the gaps between them: 1000ms then 2000ms).

9. **The backoff doubles from `BOARD_CHECK_RETRY_BASE_MS` and is capped at
   `RECONNECT_MAX_BACKOFF_MS`** — the same shape story 4's reconnect uses, which is what the PRD's
   "retries with the same backoff" asks for. It is not literally the same function: reconnecting
   is about a socket that was working, and this is about a question that was never answered, and
   pretending otherwise would couple two timings that will want to move apart.

10. **`api.ts` collapses 5xx and network failure into one answer, and keeps 404 apart.** A person
    cannot do anything different about a server that said 500 and a cable that is out, and the
    page that pretends otherwise has two messages to write and two bugs to keep. 404 stays
    separate because it *is* a different answer: the service works, and there is nothing here.
    TC-17 therefore runs the page twice with the same collapsed result (as the design asks) and
    the collapse itself is tested against a stubbed `fetch` at the bottom of `pages.test.tsx`,
    where the two are still two different answers.

11. **Story 3's `/` → random-id redirect is gone**, and with it the last place where an address
    was a detail rather than the thing.

## Task 5 — the Share panel, and what focus means

12. **The panel takes focus when it opens.** The design does not ask for it; a dialog that leaves
    the caret behind does not behave like a dialog, and the first thing anybody wants to do here is
    select the link. The effect is keyed on the boolean `open` rather than on the state name, so
    the `copied` → `open` return does not yank focus back out of the button the person just
    pressed.
13. **Escape returns focus to the Share button; a press elsewhere does not.** The design says
    focus returns in both cases. Where the press went is where the person was aiming, and stealing
    it back to a button they did not press is worse than leaving it — and in a real browser the
    press has already moved focus, so "returning" it would be a second focus change in the same
    interaction. TC-25 asserts the return on Escape and asserts the close for both.
14. **`user-event` cannot be used in the Share panel tests.** `userEvent.setup()` installs its own
    `navigator.clipboard`, which quietly replaces the stub a test is trying to observe — TC-22 then
    passes for the wrong reason. These tests press with `fireEvent` and `element.click()` inside
    `act` instead, and that is written down at the top of `SharePanel.test.tsx` because it looks
    like an omission.

## Task 7 — end to end, and one race that was always there

15. **Test numbering follows the design's coverage table, not the task prose.** Where the two
    disagree by one — the table's TC-26 is create-then-share-then-join, its TC-28 the flaky
    service, its TC-29 the refused clipboard — the table wins, because it is the document that
    says which case exists. All five are covered, in one file.
16. **`waitForBoard`, and why "the board is open" got longer.** Story 5 mounts the board after a
    fetch rather than on document load, and that exposed a race that had been there since story 1:
    the camera starts at the world origin, and the viewport learns its own size a frame later with
    the first `ResizeObserver` report. A Playwright double-click inside that window is converted
    with a viewport of no size at all, and the note lands half a screen from the pointer — TC-35
    (`sticky-notes`) failed exactly that way, and only that way, from the first run of the new
    flow. No person can be in that window; a test can be anywhere in it. The fix is in the helper
    rather than in the product or in the test: `waitForBoard` waits for the camera to be centred on
    the viewport it is drawn into, which is what "open" always meant. (`persistence` TC-21's
    2000-note board also passes it, at 1860ms of rendering.)
17. **Wall-clock budgets are logged, never asserted**, per the story's own instruction: TC-26 logs
    click-to-board against `CREATE_BUDGET_MS` (155-185ms here), TC-21's load budget likewise.
18. **Clipboard permissions are granted in Chromium only.** The design's TC-26 names Chromium,
    and the engines that gate it differently are the reason `share.copy_fallback` exists at all —
    TC-29 refuses the clipboard through an init script installed before the app's script runs,
    which is what a denial looks like from inside a page. TC-27 and TC-29 are also meant to run in
    firefox and webkit; this host still cannot start them (no GTK), as recorded under "Blocked"
    above, and the run prints that it skips them.
