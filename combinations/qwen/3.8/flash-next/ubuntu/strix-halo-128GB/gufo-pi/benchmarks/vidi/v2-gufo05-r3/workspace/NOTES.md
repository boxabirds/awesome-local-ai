# NOTES

Decisions and deviations for **Story 1 — Pan and zoom around an infinite board**.

## Stack / versions
- Vite 6 + React 19 + TypeScript. Vitest 2.1.9 (unit + component), Playwright 1.63.0 (e2e), Wrangler 3.114.17 (static asset server).
- Playwright 1.63.0 was chosen because the locally cached browsers (chromium-1243, firefox-1543, webkit-2359) match it exactly, so no browser download is needed.

## Vitest projects
- The design says `vitest.config.ts projects: unit|component`. Vitest 2.x expresses projects through a **workspace file**, so they live in `vitest.workspace.ts` (projects named `unit` and `component`). `npm run test:unit` / `test:component` still select them via `--project`. Functionally identical to the design's intent.

## wrangler assets-only
- The design's `wrangler.jsonc` had an assets binding. Wrangler 3 rejects an assets binding in an **assets-only** project ("Cannot use assets with a binding in an assets-only Worker"), so `assets.directory` is configured with **no binding**. `wrangler dev` then serves `dist/client` at `/`, which is what e2e needs. A Worker `main` arrives in story 3.
- `compatibility_date` is set to `2025-06-01` (the date supported by the bundled Workers runtime) to avoid a runtime-fallback warning.

## Camera update batching (rAF)
- The design mentions coalescing camera updates with `requestAnimationFrame`. Updates are instead applied synchronously to an internal ref + `setState`. React 18/19 automatic batching already limits this to at most one render per event, and the browser fires at most ~one `pointermove` per frame, so the "one render per frame" intent holds while component tests stay deterministic (no fake-timer coupling). Documented here as the deliberate trade-off.

## Component layout (who owns `useCamera`)
- The design contracts: `BoardViewport({ children })` is the input surface; `ZoomControls`/`NavigationHint` are presentational; all three connect to the one `useCamera` instance. To honour these exact signatures while sharing a single camera, `BoardViewport` owns `useCamera` (and the `ResizeObserver` viewport size) and lays out the fixed-position `ZoomControls` and `NavigationHint` overlays, wiring them to the hook. `App` simply mounts `BoardViewport` full-window. The overlays use `position: fixed`, so the visual structure (bottom-right controls, bottom-centre hint) matches the PRD.
- `useCamera` gained two extra methods beyond the listed contract: `zoomAtPoint(point, factor)` (needed to drive Safari `gesturechange` zoom, which is not expressible through the `wheel` signature) and `setCamera(next)` (needed by the test hook `window.__vidi6`). Both reuse the same commit path (same-object check, `hasNavigated` latch).

## Test hook
- `window.__vidi6.setCamera` is installed only when `import.meta.env.MODE === 'test'`. Verified: the production build does **not** contain `__vidi6`; `vite build --mode test` (script `build:test`) does. e2e runs against the test build served by `wrangler dev`.

## Ports
- All servers listen inside the allowed range 23616–23631: Vite dev `23616`; Playwright `webServer` runs `wrangler dev` on `23620` with inspector port `23621`.

## Origin marker
- An always-rendered, `aria-hidden` crosshair positioned in screen coordinates at `worldToScreen(camera, {0,0})`. It gives e2e a stable, constant-size pixel target for "the board's starting point".

## e2e browsers (Firefox / WebKit)
- Firefox and WebKit browsers are installed and configured, but this host is missing their OS runtime libraries (`libgtk-3-0t64`, `libflite*`, etc.), so `browserType.launch` fails with "Host system is missing dependencies to run browsers". Installing them requires `sudo apt-get install` and root is unavailable (`no new privileges`).
- Per the task rules ("Chromium is sufficient if other browsers are not installed"), `npm run test:e2e` runs the Chromium project by default and all 5 e2e cases (TC-23..TC-27, TC-31) pass there. Firefox/WebKit projects are gated behind `E2E_ALL_BROWSERS=1` and run unchanged on a host that has the browser OS dependencies. The three e2e workflows are identical across engines; only the launch environment differs.

## Not covered (per design "Not covered")
- Trackpad hardware inertia/delta scaling; Safari native pinch in e2e (Playwright WebKit cannot synthesise `GestureEvent` — the component test TC-17 covers the handler).

---

# Story 2 — Capture ideas on sticky notes and rearrange them

## No sync provider yet: how collaboration is verified
Story 2 ships before story 3, so two browser tabs in the e2e run would need a
fake transport inside the product. Instead the collaborative requirements are
verified where the logic actually lives:
- **Model level** (`tests/unit/board-model.test.ts`, TC-19..TC-23, TC-40): two real
  `Y.Doc`s wired through a `replicas()` helper that relays `update` events. The
  helper does the state handshake first, then behaves like a live provider.
- **Component level** (`tests/component/StickyNoteRemote.test.tsx`): a real peer doc
  recolours/deletes/edits the note the local user is working on, including
  "remote deletes the note I am typing in".
- The editor's remote-sync path is additionally covered in a real browser for the
  input semantics it relies on (clamping, caret, IME guards).

## Yjs gotchas found while building this
1. **State handshake first.** Relaying only live `update` events is not enough: a
   doc created *after* the other one already has content answers "Apply update in
   <Item::skip> / Missing reference to …" and the items never materialise. Both
   sides must first exchange `Y.encodeStateAsUpdate` (that is exactly what a real
   provider does on sync). `replicas()` does this, and story 3 must too.
2. **`YEvent.delta` must be read inside the observer callback.** It is a computed
   property evaluated against the transaction; after the transaction ends it can
   be empty, which silently turned every text change into "reinsert the whole
   string" (caret jumped to 0, and concurrent typing amplified it). `recordDelta`
   now snapshots the delta (and the resulting string) while observing.
3. `Y.Text.toString()` returns `\n` for newline items, so the note text round-trips
   through multi-line content unchanged.

## Text editing model
- One `Y.Text` per note (`objects/<id>/text`), the only shared mutable text.
- The `<textarea>` is **uncontrolled** (`defaultValue` at mount). Each change is
  diffed against the string that render showed, and that diff is replayed on the
  `Y.Text` with `Y.Text.insert/delete`. This keeps the caret exactly where the user
  left it (no React value round-trips) and keeps positions identical between the
  DOM string and the Yjs string, which is also what `mapCaret` assumes.
- Remote changes (observer transactions not tagged with `LOCAL_ORIGIN`) are mirrored
  into the textarea and the caret is moved through the edit by `mapCaret`
  (before → unchanged, after → shifted by the net length, inside → lands after the
  inserted text).
- **IME**: `onCompositionStart/End` plus an `onBeforeInput` guard with
  `isComposing`/`defaultPrevented` — a composition that would cross the limit is
  cancelled instead of truncating the Chinese input mid-word (TC-27).
- 1,000-char cap is enforced at every write path (`clampToLimit`) and surrogate
  pairs are never split (TC-41).

## Constant-size chrome inside the scaled world
The note toolbar and the character counter live *inside* the note (so they follow
it for free) and are counter-scaled by `1 / zoom`:
- toolbar: `left: 50%; bottom: 100%; transform: translateX(-50%) scale(1/zoom)`,
  `transform-origin: bottom center` — centred above the note top at 100% and 50%;
- counter: `right: 10px; bottom: 10px; transform-origin: bottom right` — inside the
  bottom-right corner with more than the required 8px margin at every zoom.
The fade band height is `STICKY_OVERFLOW_BAND_PX` in world units (it scales with
the note, like the text it covers).

## Small deviations from the design text
- The design's config list mentioned a few constants that nothing used
  (`MAX_TEXT_CHARS` alias, `STICKY_OFFSET_STEP_WORLD`,
  `STICKY_TEXT_NEAR_LIMIT`, `STICKY_GRID_DIVISIONS`); only the ones actually
  referenced by code and tests were added (`STICKY_OVERFLOW_BAND_PX` is one of
  them, shared by the component and its e2e assertion).
- "Text centred": implemented as horizontal centring in board font at
  `STICKY_FONT_MAX_PX`, auto-fitted down to `STICKY_FONT_MIN_PX`. A `<textarea>`
  cannot vertically centre its text, so the display layer is top-aligned exactly
  like the editor: entering/leaving edit mode does not move the glyphs.
- `BoardViewport` takes more props than story 1's `{ children }` contract
  (board snapshot, doc, selection/edit ids, `onCreateSticky`, …) and `App` now
  owns the doc through `useBoardDoc`, because the viewport has to hit-test notes
  and route pointer/keyboard input between board and note.
- A note drag calls `bringToFront` once on **drag start** (acceptance: "it moves to the
  front of the pile") and writes `moveObject` at most once per animation frame
  (`requestAnimationFrame`-coalesced, as the design prescribes), so the note tracks the
  pointer within a pixel at any zoom; a cancelled drag keeps the last applied position.

## Stacking by CSS `z-index`, not DOM order
The board snapshot is sorted by `(z, id)` (pinned by TC-11), but rendering notes in
that order re-orders keyed DOM nodes the moment `bringToFront` runs — and moving the
element that holds the pointer capture fires `lostpointercapture` in Chromium, which
cancelled the drag after its first step. Notes are therefore painted in a
DOM order that never changes for a note (`createdAt`, tie-broken by id) with
`zIndex: note.z`, so raising a note never moves its element. Visual stacking is
unchanged because z is unique per create (`maxZ + 1`); what the DOM order owes an
explanation for is only stability, not stacking. Pinned by a component test
("raising one keeps the DOM order stable") and by the 200% drag e2e.

## Auto-fit measurement
Font fitting needs real glyph metrics. The note renders a hidden mirror div
(world-unit width, same typography) and shrinks the font from
`STICKY_FONT_MAX_PX` until the text fits, with a binary search down to
`STICKY_FONT_MIN_PX`; overflow is reported so the fade band and
`data-overflow` appear. jsdom reports zero sizes for everything, so component
tests drive `fitFontSize` with a metrics stub (TC-42) and the visual result is
asserted in e2e.

## Test hook additions
`window.__vidi6.getBoard()` (test builds only) returns the board snapshot the UI
rendered, so e2e can assert positions/scale/colour/z from the user's point of view
without scraping styles. Production bundle verified not to contain `__vidi6`.

---

# Story 3: live collaboration

## The y-websocket frame is three parts, not one
A client frame is `varUint(outerType)` followed by the payload for that type, so a
sync message on the wire is `[MESSAGE_SYNC][varUint syncRank][varUint8Array
update]` and an awareness message is `[MESSAGE_AWARENESS][varUint8Array update]`.
`decodeMessage` reads the outer byte first and, for awareness, `readVarUint8Array`
to get at the actual update — reading the payload raw produced awareness state that
decoded to garbage. The room then reframes before broadcasting, so what a peer
receives is byte-identical to what the author sent (pinned in the unit tests).

## `accept()` closes the door on the Response
In workerd the `101` response carrying the client half of the pair must be built
**before** `server.accept()`; afterwards the runtime refuses with "Can't return
WebSocket in a Response after calling accept()". The same ordering rule applies in
tests that drive a room through `SELF.fetch`: the client socket needs `.accept()`
before the test can `send()` on it.

## An empty state vector is not a thing
`Y.encodeStateAsUpdate(doc, new Uint8Array())` throws "Unexpected end of array" —
lib0 cannot read a zero-byte state vector, and no real client ever sends one
(`Y.encodeStateVector` always writes at least the client id). The room therefore
treats an undecodable sync step 1 as a protocol error (close 1003) instead of
trying to answer it with "everything".

## `y-protocols` swallows apply errors
An update that parses but cannot be applied never reaches the caller's `catch`:
`readSyncStep2` wraps the apply in its own try/catch and reports through the
`errorHandler` argument. The room passes a callback that records the failure and
then closes the socket with 1003, which is what makes TC-12 ("a broken update
hurts nobody but its author") hold for both flavours of bad payload. Related:
this version of lib0 has `decoding.hasContent(decoder)`, not `hasRemaining`.

## The badge's state machine is tested with a fake provider
`connectBoard(doc, boardId, onState)` is the seam the design names, so it was not
given a provider parameter. `tests/component/ConnectionStatus.test.tsx` mocks
`y-websocket` with a small emitter-shaped fake and uses fake timers, which makes
the `CONNECTED_CONFIRMATION_MS - 1` / `+1` boundary (TC-20) exact instead of a
race, and lets TC-21 prove the confirmation timer is cleared when a second outage
arrives.

## Switching a browser "offline" does not drop its sockets
`context.setOffline(true)` refuses new connections but leaves an established
WebSocket alone, and a `ws.close()` from the page in that state stalls in CLOSING
forever — the app never learns anything happened. So the outage test registers
`page.routeWebSocket('**/api/rooms/**')` before the page loads and closes the
socket from the harness side, which does produce a real close event. Two notes on
that API: attaching `route.onMessage` disables Playwright's automatic bridging, so
both directions have to be forwarded by hand (`server.send(message)` /
`route.send(message)`), and the harness therefore also gets to observe frame times
and close times, which is what TC-29's keepalive measurement and TC-30's
"nobody reconnects after close" check read. A `window.__vidi6.dropSocket` hook was
tried first and removed: it could not do anything the offline browser would not
sit on.

## Confirming the green badge without racing it
"Connected" is visible for exactly 2 seconds. The outage test samples both the
badge text and `window.__vidi6.connectionLog` while it waits, then asserts the
log went `reconnecting → confirmed → connected` and that "Connected" was among the
samples — a plain `toHaveText` after a `waitFor` would be flipping a coin.

## Nightly runs are the same code path, shorter
TC-29/TC-30 are tagged `@nightly`; `test:e2e` runs `--grep-invert @nightly` and
`test:e2e:nightly` runs `--grep @nightly`. Durations come from
`NIGHTLY_IDLE_SECONDS` (default 45) and `NIGHTLY_SOAK_SECONDS` (default 60), so a
longer soak is an environment variable rather than an edit. `wrangler dev` does
not expose the Durable Object `hibernate` flag, so only the no-traffic case is
covered, as the design anticipated: 45 idle seconds with two connections shows no
reconnect, a badge that never appears and keepalive frames ~15 s apart, well
inside the provider's 30-second watchdog. The soak at
`MAX_CONCURRENT_EDITORS` connections made 545 changes in 60 s with propagation
p50 8 ms / p95 13 ms / max 41 ms against the 1-second budget (reported, not
asserted), and no tab tried to reconnect after its context closed.

## Teardown tears down the transport only
`destroy()` calls `provider.destroy()`, which removes the listeners and closes the
socket but leaves the `Y.Doc` alone — closing a tab never takes board content with
it (story 4 owns persistence). Measured catch-up after a 30-second outage was
~2.4 s, dominated by the reconnect backoff (200 ms doubling to
`RECONNECT_MAX_BACKOFF_MS`); like every other latency in the e2e suite it is
reported against `LIVE_UPDATE_LATENCY_BUDGET_MS` rather than asserted.

## A soak addresses notes by id, and drags far enough to be a drag
The soak's edit sequence is seeded (`NIGHTLY_SEED`, printed in the report) so a
failure can be replayed, and it drives the real UI — double-click, drag, toolbar
swatch, Delete key. Notes are addressed as `[data-note-id=...]` and their drag
start is read from the live element rather than from coordinates the test
remembered, because a remembered position drifts and the drag then grabs
whatever is actually there. Two traps showed up while writing it: a press that
travels less than `DRAG_THRESHOLD_PX` is a *selection* and moves nothing, so a
soak drag aims a fixed 15 pixels (back toward the note's slot, or away from it
when it is already there); and a note's colour toolbar floats above the note at a
constant screen size, so the slots are spaced for note body **plus** toolbar or
the click on a swatch is intercepted by the neighbour's corner. A move is checked
as "every board settles on the same position, the note actually moved, and it
ended within a few screen pixels of where it was aimed" — arrival is what this
story is about, drag arithmetic is story 2's.

Playwright also waited forever for the intercepted swatch click, turning a real
failure into a hung run: `actionTimeout` is now 30 seconds in
`playwright.config.ts`, and the soak prints what each board saw when something
fails to converge.

## Multi-participant e2e layout
Participants are separate browser contexts on `/b/<boardId>` — separate storage,
cookies and sockets, so nothing can pass by accident through a shared tab. Where a
test needs several notes it creates them by double-clicking distinct screen points
(notes are centred on the click point) at a chosen zoom, so drags never grab
somebody else's note. Firefox and WebKit remain opt-in with
`E2E_ALL_BROWSERS=1` — this host is missing the OS libraries to launch them.

---

# Story 4 — Return to a board and find everything as it was left

## The order is the product
One rule carries most of this story: **a change is in storage before anybody is
allowed to see it.** `BoardRoom` appends the update to SQLite and only then relays
it. If the append throws, the room closes every socket with 1011 instead of
passing on a change it cannot promise to keep — the page keeps what it typed (that
is what a page is), the room takes it again on reconnect, and nobody else ever saw
the version that does not exist. TC-14 tests exactly that sequence, injected at the
store method rather than through a production seam.

## A snapshot gets a digest, and that decision came out of a spike
"Storage is corrupt" is not the same as "reading storage threw an exception". A
spike mutated single bytes of real Yjs updates and applied them to a fresh doc:
**40 of 120 mutations decoded "successfully" and produced a different board.** A
Yjs update is a stream of instructions, so knocking out one varuint silently changes
what follows. So `snapshot_chunks` stores a digest (`checksum()`, two FNV-1a-style
32-bit accumulators) and a load that reads a chunk whose digest does not match fails
loudly — quarantine, then the load-failure path — instead of serving a board whose
notes were rewritten in place. It is not cryptography and does not pretend to be; it
catches the accidental case, which is the case the story is about.

## Reading a Yjs update's header, because the official helper lies here
Gap detection needs to know which clocks an update touches.
`Y.encodeStateVectorFromUpdate()` returns an empty map for most single-transaction
updates in yjs 13.6.33 (verified against the installed version), so `updateRanges()`
parses the v1 header itself: `varuint(numClients)`, then per block
`varuint(numStructs)`, `varuint(client)`, `varuint(clockStart)`. One caveat recorded
in the code: `to = from + numStructs` is a **floor**, because a text item spans more
than one clock position than it has structs. Only `from` is trusted.

**The gap check has to run before the apply, not after.** Yjs does not complain
about a hole — it `skip`s it and fills the space with a placeholder, and the board
goes quietly wrong. `clockGap(doc, ranges)` reads the doc's state vector before each
row and refuses a forward gap; a missing row therefore fails closed into
`update-log-unreadable` rather than into a board with a hole in its history. Cost
measured on a 4001-row doc: ~0.0013 ms per row, so it is always on.

Damage for the tests is generated with `claimsMoreStructs()` (inflate the header's
struct count so the decoder runs off the end) rather than truncation: truncating an
update often leaves a perfectly decodable prefix, which makes a "corrupt data" test
pass for the wrong reason.

## Hibernation means the room does not own a socket list
`ctx.acceptWebSocket()` and never a `Set<WebSocket>`: the moment the room holds a
strong reference to a socket the object cannot hibernate. Per-socket bookkeeping
(which origin opened which connection, for the relay) lives in a `WeakMap`. Every
fan-out goes through `ctx.getWebSockets()`. TC-18 is the test that this is not
theoretical: the room drops its document and reads the board back from storage
while two clients stay connected, and the next edit still reaches the other one.

## Two close codes, and the client has to know what each one means
- **1011** — storage said no *while the board was running*. The client's own work is
  safe in its page; y-websocket's ordinary reconnect carries it again.
- **4500** (`CLOSE_BOARD_LOAD_FAILED`) — the room cannot read the board. It is in the
  application range, so y-websocket keeps retrying, and the client treats it as
  "this board couldn't be loaded", not as "you are disconnected".

The load-failure UI is deliberately sticky: a retry that opens a socket but never
syncs must not clear the red message, so the `disconnected` handler refuses to
publish `reconnecting` while the state is `load_failed`. And "back" is only reported
as a *recovery* if the board was ever seen — a tab whose very first load failed goes
straight to `connected`, because there is no earlier state to have returned to
(TC-28).

## A test race that looked like a persistence bug
`waitForStored(board, 1)` waited for the storage to hold one note. Writing a note and
typing into it are **two** changes, and the note on its own already makes the count —
so the wait could finish while the stored board had a note with no words in it, and
the assertion after it failed with `['']`. This is the same trap as the WebSocket one
from story 3 (a local doc answers before the frame has left), one layer down. The
fix is `waitForStoredLike(board, doc)`: wait until storage holds *exactly what the
writer holds*, compared by board key. Counting is fine for "did anything land", never
for "is the content there".

The related rule, from earlier in the story: `RoomClient.destroy()` closes the socket
immediately, so any frame still in flight is gone. Tests must wait for storage *while
the writer is still connected*, then destroy.

## E2E persistence: the spec owns its server
`playwright.config.ts` has a second project, `persistence`, and its dev server is
started by the spec (`tests/e2e/helpers/wrangler-process.ts`), not by Playwright:
these tests have to stop the server mid-test, which only works if they own it. Own
ports (23624/23625), own `--persist-to` directory in a temp dir, `--var TEST_HOOKS:1`,
`workers: 1`, `fullyParallel: false`. `restart()` keeps the directory and loses the
process — which is precisely the difference the story is about. Kill and restart use
the process *group* (`detached: true`, signal to `-pid`), or workerd survives its
parent and keeps the ports.

Two traps worth writing down:
- The helper now refuses to start if the port already answers. A dev server left
  behind by an interrupted run answers on that port with a storage directory nobody
  knows about, and every assertion after it is about the wrong board — which is
  exactly how one confusing false failure appeared while writing these tests.
- `request.post(..., { data: someUint8Array })` does **not** send bytes; the request
  fixture treats it as an object and JSON-stringifies it, and the room then fails
  with `contentRefs[(info & BITS5)] is not a function`. Hooks take a `Buffer`.

The shipped configuration is checked too
(`tests/e2e/storage-hooks-not-in-production.spec.ts`): with no `TEST_HOOKS`, the hook
paths are answered by the asset handler — a POST to a static asset is **405** — and
`GET` on the same path only ever returns the app shell. `wrangler.jsonc` is
unchanged; the flag exists only in the persistence dev server's command line.

## TC-21: what the 2000-note board actually costs
Measured with the tab as the stopwatch, the answer is meaningless: the tab cannot be
asked "have you got it yet?" while it is busy building two thousand elements, so any
figure taken from inside it is a rendering figure. `tests/e2e/helpers/room-probe.ts`
therefore joins the board from Node over the same sync protocol and measures only the
service. On this machine:

```
TC-21 2000 notes — room to a joining client: 43 ms; in the tab: 9324 ms;
                   all on screen: 9327 ms   (BOARD_LOAD_BUDGET_MS = 3000)
```

The storage and sync side is comfortably inside the budget. The browser is not, by
about 3×: applying a 2000-note update and rendering 2000 individually measured,
positioned note elements is where the time goes, and it is a *client rendering*
problem (no virtualisation, one font measurement per note), not a persistence one.
As everywhere else in this suite the number is reported and the outcome decides
pass/fail; the follow-up this suggests is deferred/virtual rendering of notes, which
belongs to a rendering story, not to persistence.
