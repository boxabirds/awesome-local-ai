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
