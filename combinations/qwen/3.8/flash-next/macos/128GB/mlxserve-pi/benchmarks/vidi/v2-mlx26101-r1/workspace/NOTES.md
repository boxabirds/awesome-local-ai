# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Stack versions
- Vite 7 + @vitejs/plugin-react 5 + vitest 4 (mutually compatible peer ranges).
  React 19, TypeScript 5.7. Playwright 1.63 (the three browsers already present
  on this machine — chromium-1243, firefox-1543, webkit-2359 — match 1.63).
- `npm install` on this machine runs behind an `allow-scripts` policy that skips
  `esbuild`/`workerd` postinstall scripts, but the platform binaries are already
  present and both Vite and `wrangler dev` run, so this is not a blocker.

## Component / wiring architecture (small deviation from the design's prop lists)
- `App.tsx` owns `useCamera(viewport)` and the `ResizeObserver`-measured viewport
  size, and passes camera + intent callbacks down. The design shows
  `BoardViewport({ children })` and `ZoomControls`/`NavigationHint` as leaf
  components wired in `App`; to keep a single camera instance shared by the
  viewport surface and the controls without inventing a new context file that is
  not in the prescribed layout, `BoardViewport` additionally accepts `camera` and
  handler props. Its DOM-event wiring (pointer / non-passive `wheel` / Safari
  `gesture*` / window `keydown`) lives inside `BoardViewport` exactly as the
  design describes; it is otherwise presentational.
- `useCamera` keeps the source of truth in refs and only calls `setState` when a
  camera mutation returns a *new* object, so no-op inputs (a click without
  movement, a zoom at a limit) never re-render and never latch `hasNavigated`
  (required by TC-29 / nav.hint).
- Camera updates are plain React `setState` calls (React batches per event)
  rather than an explicit `requestAnimationFrame` coalescer, so component tests
  are deterministic without timer plumbing. React already coalesces the multiple
  updates a single gesture event can produce; wheel/pinch events fire discretely
  and render once each. Noted as the one intentional omission from the design's
  implementation notes.

## Safari gesture mapping
`useCamera`'s contract exposes only `wheel(e)` (no separate gesture method), so
`BoardViewport` maps a Safari `gesturechange` scale onto the pinch path by
passing `deltaY = -ln(scale) / WHEEL_ZOOM_SENSITIVITY` with `ctrlOrMeta: true`;
`zoomAt` then receives exactly `scale` as its factor. Behaviour is identical to
the design's "zoomAtPointer scale ratio".

## Origin marker
Rendered in all builds as a 0x0 element at world (0,0) inside the world layer, so
`getBoundingClientRect()` is exactly `worldToScreen(0,0)` at any zoom. A visible
red crosshair is counter-scaled by `1/zoom` so it stays a constant on-screen size
while remaining a stable pixel target for e2e (TC-23 / TC-24 / TC-26).

## Test-mode hook
`window.__vidi6.setCamera/getCamera` is installed only when
`import.meta.env.MODE === 'test'` (`src/client/canvas/testHooks.ts`). e2e builds
with `vite build --mode test` so the hook is present; `npm run build` (production)
contains zero `__vidi6` references (verified).

## E2E serving & ports
`npm run test:e2e` = `vite build --mode test` then Playwright, whose `webServer`
is `wrangler dev` serving `dist/client` (static-asset path the story-3 Worker
will reuse). Servers bind the allotted agent ports only. `reuseExistingServer`
is disabled and the build runs before the server starts, because `wrangler dev`
here disables its assets directory watcher past the platform watch limit, so a
reused process could otherwise serve stale hashed asset filenames after a rebuild.

### Browsers (environment limitation)
Chromium, Firefox and WebKit binaries are all present, but **only Chromium can
actually launch in this sandbox** — Firefox aborts with "Failed to launch the
browser process" and WebKit exits `Abort trap: 6` on `browserType.launch()`
(reproduced with a bare `firefox.launch()` / `webkit.launch()` script). Per the
story rules, Chromium is therefore sufficient here. The three Playwright projects
are all defined; the run defaults to Chromium and the other two are enabled on a
capable machine with `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e`.
No test cases were removed or weakened for this.

### Port budget
This sandbox will not let the agent list or kill processes, and workerd child
processes survive their parent, so each `wrangler dev` run leaks its two ports.
The remaining allotted ports were used one run at a time; the committed config
points at ports that were free during the final green run.

## e2e interpretation note
TC-24 "zoom over a dot" is verified by hovering the pointer over the origin
marker (a distinctive, locatable grid feature) and asserting it stays under the
pointer ±1px while `visualViewport.scale` stays 1; dots are a CSS background
pattern with no individual element to track.

---

# Notes — story 2 (Capture ideas on sticky notes and rearrange them)

## Board model / schema
- `board-model.ts` stores one `Y.Map` "meta" and one `Y.Map` "objects"; a sticky
  is `{ id, type:'sticky', x, y, z, color, text:Y.Text }`. `snapshot(doc)` returns
  notes sorted by `(z, id)` so every client stacks them identically.
- `setStickyColor` returns `true` even when the colour is unchanged, matching the
  design's literal contract (`(doc,id,color) => boolean` = "the note exists").
  `createSticky` returns `''` (falsy) on non-finite coordinates.

## Stable DOM order vs. z-index (bug found by TC-39)
`snapshot` sorts by `z`, so `bringToFront` would reorder the array and React would
relocate the dragged note's DOM node, which fires `lostpointercapture` and aborts
the drag mid-gesture. Fix: `App` renders notes in a DOM order that never changes
(stable by `id`) and expresses stacking purely through CSS `zIndex: note.z`. A
`bringToFront` now only changes a style number, so the note keeps its pointer
capture while dragging. This preserves the CRDT-deterministic `snapshot` order
(unit-tested) and the visual z-ordering.

## Per-note toolbar hit area
The `1/zoom` counter-scaled wrapper sets `pointer-events:none` so it never blocks
the board; the `NoteToolbar` itself sets `pointer-events:auto` to stay clickable.
`.sticky-note` no longer sets `overflow:hidden` (the `.sticky-text` box clips its
own content), otherwise the toolbar that floats above the note's top edge would
be clipped and unclickable.

## Test-mode board-doc hook
`App` also exposes `window.__vidi6Board` (the live `Y.Doc`) when
`import.meta.env.MODE === 'test'`, so component tests can simulate model-level
events (a note deleted by a remote user mid-drag / mid-edit, TC-37). Production
builds contain no reference to it. Component tests additionally override
`requestAnimationFrame` to fire synchronously so a drag's rAF-throttled
`moveObject` write lands inside the same `fireEvent` (deterministic, no timers).

## Browser coverage
Same environment limitation as story 1: only Chromium can launch in this sandbox,
so the default run is Chromium and Firefox/WebKit are opted in elsewhere
(`E2E_BROWSERS=...`). No sticky test cases were removed or weakened.

---

# Notes — story 3 (See other people's edits appear live on the same board)

## BoardRoom relay details worth knowing
- A reply envelope must start with the **outer** message type: y-websocket's
  `messageHandlers[messageSync]` writes `messageSync` into the reply encoder
  before calling `readSyncMessage`. Doing only the latter produces frames whose
  first byte is a *sync* type, which the peer reads as an awareness frame. Both
  the room and the test client write the prefix.
- `readSyncStep2` swallows `Y.applyUpdate` failures unless you pass it an error
  handler, so the room passes one that rethrows: that is what turns a corrupt
  document update into the required `close(1003)` instead of a silent ignore.
- When a peer closes its socket, workerd does **not** echo the close on our side
  automatically, so the room's `close`/`error` listeners call `close()` too
  (after forgetting the socket). Without it a browser/test client sits in
  `CLOSING` forever waiting for the handshake to complete.

## Integration tests inside workerd (`@cloudflare/vitest-pool-workers`)
- `SELF.fetch(url, { headers: { Upgrade: 'websocket' } })` returns status 101 with
  `response.webSocket`: that is the *client* end of the room's `WebSocketPair`
  delivered through the service binding, and workerd requires `accept()` on it
  before it may be used. Everything else is real — real Yjs, real WebSocket
  frames, real Durable Object.
- TC-04's "no object instance created" is checked with
  `listDurableObjectIds(env.BOARD_ROOM)` from `cloudflare:test` before and after
  the request instead of spying on `idFromName`: it observes the real thing (no
  instance exists) rather than a mock call, and needs no test-only seam in the
  Worker.
- TC-18's "restart" is `evictDurableObject(stub, { webSockets: 'close' })` — the
  object is really gone, and because story 3 persists nothing the fresh instance
  starts from an empty document. The reconnecting client keeps its own `Y.Doc`
  (`RoomClient.reconnect()` swaps only the socket), which is exactly the browser
  case: the tab still has the board and refills the room.
- TC-31's dead socket is created deterministically inside the room
  (`runInDurableObject` closes one socket and mutates the doc in the same turn),
  because a client-initiated close may already have been processed by the time
  the next update is broadcast.
- `tsconfig.json` gets `cloudflare:test` types from
  `/// <reference types="@cloudflare/vitest-pool-workers/types" />` in
  `tests/integration/env.d.ts`; the single project keeps `lib: DOM` for React and
  `@cloudflare/workers-types` for the Worker, which coexist under `skipLibCheck`.

## The badge in React (TC-19 to TC-21)
- `ConnectionStatus` does not talk to the provider: `connectBoard` feeds a separate
  state machine, `createConnectionTracker(onState)`, which turns the provider's
  `status`/`sync` events into the four states the badge renders. The component tests
  drive that machine directly with fake timers and a `MockProvider extends
  EventEmitter`, so the 2 s "Connected" confirmation is testable in milliseconds and
  there is nothing fake about a real provider in real use.
- The component project aliases `y-websocket` to
  `tests/component/y-websocket-stub.ts` (a `WebsocketProvider` that only
  remembers the doc and emits what a test tells it to). The alias is at the
  *project* level in `vitest.config.ts`, next to `test:`, not inside it — other
  projects keep the real package.
- The badge's URL is rewritten in an effect, never during render, and
  `publishConnectionState` keeps its latest value in a module-level variable so a
  remount shows the current state instead of a blank moment.

## E2E with several people on one board (TC-22 to TC-28)
- Each person is a browser **context** of one browser (`helpers/participants.ts`),
  so nothing can be shared through `localStorage`, a BroadcastChannel or a cache —
  the only path from one screen to another is the worker and its room. The helper
  also waits for `window.__vidi6.board().sync` (the provider's own sync flag)
  before a test starts issuing changes, so a "did it arrive in 4 ms" measurement is
  not measuring the initial sync.
- Latency is *measured and logged*, and only fails past
  `E2E_PROPAGATION_GUARD_MS` (2 s) — the number the PRD cares about is
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (1 s), which the runs report (observed 1-30 ms).
  Tests for "both people end up seeing the same thing" wait for the screens to
  agree, so they say what is true rather than how long it took.
- `window.__vidi6Board` was already taken: story 2's `App.tsx` puts the raw
  `Y.Doc` there for the component tests. The e2e handle is `window.__vidi6TestBoard`
  (`{ doc, notes(), create(), moveTo(), color(), write(), remove() }`) and is
  installed by `installBoardHandle` in test hooks only.

## Two people typing into one note (why TC-23 is written the way it is)
- The editor used to commit the whole box contents as a diff against the document.
  With two people in one note that deletes the other person's characters: Sam's
  commit was computed against a base that did not contain Alex's newest letter.
  It now commits the **delta since this box last wrote** (`textDelta` +
  `applyTextDelta`), so a local keystroke is a splice into wherever the shared text
  has got to, and a remote change is adopted into the box with the caret stepped
  around it (`caretAfterRemoteEdit`).
- What Yjs guarantees here, and what the test asserts: all replicas end up with the
  same text, and nothing is lost or invented — the merged text is made of exactly
  the characters typed, no more and no less. What is *not* guaranteed (and the test
  says so in a comment): that each person's own word stays in one piece. Each
  keystroke is its own transaction placed at a caret that remote text has moved,
  and this story has no presence or "who is editing what" — that is a later story.
  Verified over 12 runs: convergence and the exact character multiset every time.

## Deliberately clicking a note that is already selected
- Story 2 hides a note's toolbar while `drag.current.state === 'dragging'`, but
  `drag` is a ref: nothing re-rendered when the drag ended, so after moving a note
  its toolbar stayed hidden until something else happened to re-render the note.
  `StickyNote` now mirrors the drag into a `dragging` state (`setDragging`) — the
  toolbar is back the moment the pointer is released, which is what TC-25 needs.
- Clicking an already-selected note *deselects* it (story 2's behaviour), so
  `ensureSelected` in the helper clicks a note only when it is not selected, and if
  a selected note has no toolbar it clicks twice — off, then back on — instead of
  hanging on a click of a button that is not on screen.

## Simulating a dropped network for one person
- `context.setOffline(true)` does **not** drop an established WebSocket in this
  Chromium build: the page stayed "Connected" through it. What works is routing the
  socket yourself: `context.routeWebSocket(/\/api\/rooms\//, route => ...)`, keep
  the `route.connectToServer()` pair, and to simulate the outage close **the page
  side** of it (`route.toPage.close({ code: 1011 })`) while a flag makes every later
  reconnection attempt get `route.close(...)` too. Turning the flag off lets the
  provider's next attempt through, and the badge goes
  Reconnecting… → Connected → gone in about 2.5 s.
- Closing only the *server* side of that pair does not reach the page in Playwright
  1.63, which is a confusing half an hour: close the page side.

## Keeping a dev server honest in this sandbox
- `wrangler dev` snapshots the **asset list** when it starts. Rebuilding
  `dist/client` does not refresh it — the fresh `index.html` then points at a bundle
  the running server answers with the SPA fallback HTML, and the app dies with
  "Failed to load module script ... MIME type text/html" (a whole suite of tests
  failing because the server was quietly stale). Touching a *Worker source* file
  makes wrangler reload and read the new assets, so `npm run test:e2e` does
  `npm run build:test && touch src/worker/index.ts` before Playwright starts. In a
  clean environment Playwright starts the server after the build and the touch is
  simply harmless.
- Two `wrangler dev` processes sharing the default local state directory
  (`.wrangler/state`) make the second one kill workerd with
  `database is locked: SQLITE_BUSY` — the server dies with "The Workers runtime
  failed to start", which reads like a broken Worker and is nothing of the sort.
  There is no `persist` key in this wrangler version's config schema, so the
  Playwright `webServer` command passes `--persist-to
  node_modules/.tmp/wrangler-state-<port>`: each dev server keeps its own local
  state and they cannot lock each other out. Story 3 stores nothing anyway.
- Chromium slows timers in pages it believes are hidden, which can postpone the
  badge's 2 s "Connected" timer for tens of seconds when several boards are open at
  once. The chromium project launches with `--disable-background-timer-throttling`,
  `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`.

## Nightly (TC-29, TC-30)
- Selected by tag: `npm run test:e2e` runs `--grep-invert @nightly`,
  `npm run test:e2e:nightly` runs `--grep @nightly`. A separate Playwright project
  would need its own browser and webServer entry for no benefit.
- The idle test freezes the page clock (`page.clock.install()` then `runFor(5000)`
  eleven times) to sit 45 s of page time in under a second, and proves the badge
  never flickered with a MutationObserver recorder installed in the page — an
  observer needs no timers, so it keeps working while the clock is frozen. The
  socket is real (the clock does not touch it), and a change made afterwards still
  crosses in 1 ms.
- The capacity test is five contexts × 200 seeded operations (`randomBoardOps`,
  1000 writes in ~200 ms) and asserts the screens converge (observed ~1.1 s), that a
  6th person is not turned away and catches up, and that one more change still
  arrives quickly afterwards.

---

# Notes — story 5 (Share a board with others using a link)

## `App.tsx` became a router shell (deviation from the design's file list)
The design's `src/client/pages/*` layout assumes the board is a page that can be
mounted behind a link check. Story 4 left the whole board inside `App.tsx`, so
`App.tsx` is now only `useRoute()` → `HomePage` / `BoardPage` / `NotFoundPage`, and the
board itself moved, unchanged, to `src/client/board/Board.tsx` (one extra file, not in
the design's list). Nothing in the board's behaviour moved with it: `Board` still owns
`useBoardDoc` → `connectBoard`, the viewport, the tool rail and the load-failure badge.
`SharePanel` is mounted by `BoardPage` beside `Board`, so the Share control exists only
where a board actually exists — a not-found page has no Share button to click.

## `initialize()` answers `created | exists | failed` (deviation, and why)
The contract in the design is `created | exists`, with a storage failure thrown. In this
repo the integration tests run inside workerd under `@cloudflare/vitest-pool-workers`,
whose RPC plumbing (`getRPCPropertyCallableThenable`) turns a *throwing* RPC method into
an unhandled rejection that fails the test file even when the caller catches the value.
So `createBoard()` catches and maps the failure to `'failed'`, and the Worker answers
`500 {error:"create_failed"}` — the same thing the design asks the client to see, one
return-value earlier. TC-12 still exercises the real failure path: it patches
`BoardStore.prototype.markCreated` to throw, so the throw happens inside the Durable
Object, inside `initialize()`, on the way to real SQLite.

## Existence must not write, so `migrate()` moved out of `load()`
`load()` used to create the tables on first touch. A `GET /api/boards/:id` is now a
question about a board that may not exist, so `load()` reports "empty" when the tables
are absent instead of making them, and `migrate()` runs from `initialize()` and lazily
before the first `append()`. TC-06 asserts the negative end of this with
`SELECT name FROM sqlite_master` on a never-opened link: no tables at all. Related trap:
`namespace.listDurableObjectIds()` yields opaque ids, never the board-id strings, so
tests that ask "did that link create anything?" compare against
`namespace.idFromName(boardId).toString()`.

Legacy boards (story 4 shape: update rows, no `created_at`) exist. `existsReadOnly()`
answers true on `created_at` **or** any row in `updates` / `snapshot_chunks`, which is
what makes TC-31's pre-sharing board open instead of being declared missing.

## 404 for a malformed room link (was 400)
`/api/rooms/:id` with an id that cannot be a board now answers 404 without touching the
namespace, per the design's HTTP table — "there is no such board" is the honest answer,
and it is the same answer the browser's link check gives. Story 3's `worker.test.ts`
TC-04 was updated from 400 to 404 for that reason; nothing about the check was weakened
(it still asserts the namespace is never consulted).

## Test hooks on the e2e server
`playwright.config.ts` now passes `--var TEST_HOOKS:1` to the `wrangler dev` it starts,
so story 4's board-surgery hooks and story 5's `/__test/boards/:id/seed-legacy` exist
under `npm run test:e2e`. `wrangler.jsonc` still has no such var, so a deploy serves
`/__test/...` as the SPA and TC-24's "production lacks the hooks" assertion stands. The
seed hook writes the fixture's Yjs updates through the store's own `append()` and then
re-reads the document, so the board a browser then opens is disk content, not test
scaffolding.

## E2E boards are created, not invented
Every e2e board id now comes from `POST /api/boards` (`createBoard(request)` /
`createBoardAt(baseURL)`), because a link only works if something was created behind it.
The restart specs need their ids *after* their own `wrangler dev` processes are listening,
which is why they build boards in `beforeAll` rather than at module scope.
`RoomClient.connect()` in the integration helpers does the same before upgrading a
socket — create, then connect, exactly the order a browser uses; `initialize()` is
idempotent, so a rerun answers `exists` instead of resetting somebody's board.

## Clipboard: one test takes the yes, one forces the no
TC-26 grants `clipboard-read` / `clipboard-write` to Chromium and reads the link back
out of the **real clipboard** with `navigator.clipboard.readText()`, then opens that
text in a second context — so what is proven is that the bytes handed over are the
bytes the second person lands on. TC-29 does the opposite: an init script replaces
`navigator.clipboard` with one whose `writeText` rejects with `NotAllowedError` before
any page script runs, and asserts the manual message plus a full selection
(`selectionStart === 0`, `selectionEnd === value.length`, focus in the field). Neither
test asserts anything about a duration. `writeText` (not `write([ClipboardItem])`) is
what the design names, and jsdom has no `ClipboardItem` at all.

## Timings (logged, never asserted)
- click → board ready: **165 ms / 234 ms** (budget `CREATE_BUDGET_MS` = 2000 ms).
- Sam's edit visible on Maya's screen: under the 15 s functional timeout, in practice
  a few hundred ms.

## Browser coverage (task 7's cross-browser clause: blocked on this machine)
Tasks.md asks for TC-27 and TC-29 in Firefox and WebKit as well. They cannot run here:
`E2E_BROWSERS=firefox` fails at launch (`firefox ... <process did exit: signal=SIGABRT>`),
and `E2E_BROWSERS=webkit` fails the same way (`pw_run.sh ... exitCode=134`) — the same
sandbox limitation as stories 1–4, so the default run stays Chromium. Neither test uses
an engine-only API (`page.route`, `addInitScript`, `selectionStart`, `data-testid`), so
they are ready to run wherever those browsers start. TC-26 deliberately holds the only
clipboard-permission grant in the file, so the two engine-independent recovery tests
never inherit a Chromium-only assumption.

---

# Notes — story 9 (Write free text anywhere on the board)

## The text box is measured, stored, and only ever re-measured by the client that changed it
`layoutText` (src/client/objects/textLayout.ts) is pure and takes a `Measurer`, so the
wrapping rules (auto width = longest line + `TEXT_AUTO_WIDTH_PADDING_WORLD`, capped at
`TEXT_MAX_AUTO_WIDTH_WORLD`; a line that wraps makes the box fill to the cap; fixed
width rewraps; `height = lines × font size × TEXT_LINE_HEIGHT`) are unit-tested with a
fake measurer and exact arithmetic. `useTextBoxSync` calls it and writes the box only
after a **local** change — a remote keystroke never makes this client write, so nobody
argues about the box and the document does not fill with redundant updates. `setTextBox`
skips the write when width and height are unchanged, which is why TC-21's "no third
rewrite on every edit" is countable with an observer.

## Stored heights are whole numbers
`heightFor()` rounds: `Math.round(lines × fontPx × TEXT_LINE_HEIGHT)`. With
`TEXT_LINE_HEIGHT = 1.3` and size XL (56) the exact value is a fraction; storing
`218.4` and then re-measuring `218.39999...` would look like a real change on every
keystroke and re-write the box forever. Stored boxes are integers, and the e2e asserts
heights as exact multiples of `size × 1.3`.

## Auto-width padding is a decision, not a measurement
Design says "width = the longest line, capped at 600". A box exactly as wide as its
longest line wraps on the next pixel, so the box is the longest measured line **plus 16
world units** of padding (`TEXT_AUTO_WIDTH_PADDING_WORLD`), still capped at 600. TC-26
asserts the cap ±2 and TC-27 asserts a drag's width ±2, so the padding is visible in the
tests rather than hidden in the layout.

## The measurer is OffscreenCanvas only, with an estimate underneath
`createCanvasMeasurer()` uses `OffscreenCanvas` and nothing else. It deliberately does
**not** fall back to a DOM `<canvas>`: in an environment without canvas support (jsdom, a
server render) asking for a 2d context logs a "Not implemented" error even though the
call returns null, so the estimate would come with console noise on every test run.
Where there is no canvas, `estimateTextWidth` (`length × fontPx ×
TEXT_AVG_Glyph_WIDTH_RATIO`) is used and nothing throws (TC-32). Production gets one
`Measurer` from `MeasurerProvider` (src/client/objects/textMeasurer.ts); component tests
hand it a fake `(text, fontPx) => text.length * fontPx * 0.5` so the box arithmetic in
TC-12/TC-19 is exact instead of "roughly right".

## One editor for notes and text
`StickyTextEditor` is now a thin wrapper over the new `TextEditor` (character budget,
auto-fit font, counter, classes, test ids), which is how story 9 gets "text edits
exactly like a note" for free — the delta-since-last-write commit, IME composition,
`caretAfterRemoteEdit` adoption, Escape-keeps-selected, click-outside-deselects and the
undo boundaries are all the same code, still verified by story 2's own component and e2e
tests. `TextObject` and `StickyNote` both render through it.

## Why `onEnd()` runs before `undo.boundary()` in the editor
An empty text object is deleted when its editor closes (`deleteIfEmpty`). The editor
used to open a new undo capture window as it closed; that put the deletion in a *later*
undo step than the keystroke that emptied the text, so one Ctrl+Z left an empty husk
object on the board. `onEnd(...)` (which runs the deletion) is now called **before**
`undo?.boundary()`, so emptying a text and removing it undo together, and TC-25's
"creation and typing are two steps" still holds because the boundaries around the edit
itself are unchanged.

## Story 6 identity is not built, so `createdBy` is a client id
`src/client/board/author.ts` is the one function that answers "who is writing" and it
returns `String(doc.clientID)` — stable per tab, correct for TC-20's "the object records
who made it", and it is a one-line replacement when story 6's real identities land.

## A story 9 shortcut must not eat a story 2 keystroke (bug found by the e2e suite)
Giving the letter `N` to "new sticky note" broke story 2's TC-26 ("a note deleted while
someone edits it just goes away"), and it is a real product bug, not a test quirk: when
someone else deletes the note you are typing into, the editor unmounts and the browser
delivers the **rest of that person's keystrokes** to the board with focus on nothing.
Their typing was `' while editing'`, so the `n` in *editing* made a new sticky note and
the `g` after it went inside it — a note appeared out of a deleted note. The guard in
`useBoardKeys` records the last keystroke a text field actually swallowed and ignores
letter keys for `TYPING_BURST_MS` (250 ms) after it. Deliberately narrow:
- Only keys that *insert* text count. Ctrl/Cmd+Z, Ctrl/Cmd+A and Ctrl/Cmd+D are chords,
  and a person presses undo the instant after they stop typing — the first version of
  this guard swallowed story 8's TC-24 for exactly that reason.
- Escape is not text either, so leaving an edit with Escape and then pressing `N` works
  (that is in TC-18 already).
- It is a burst guard, not a ban: TC-18b asserts the note reappears once the person has
  demonstrably stopped typing.

## The Text tool clicks *through* to a new object on top
With Text held, a click on an existing object still creates text at that point (PRD:
"new text is created on top at that point"), so the handler is registered in the
**capture** phase on the viewport: an object's own `pointerdown`/`click` handlers, which
stop propagation, never get the chance to turn the click into a selection (TC-17).

## Horizontal-only handles, and what a group resize does to text
`registry.tsx` carries a per-type `handles` field (`'horizontal'` for text) and
`SelectionOverlay` renders only e/w for such an object: a text object's height is content,
never a drag target (TC-22). When text is resized in a group with notes, the mixed path in
`useTransformGesture` scales positions as story 7 does and rewrites a text object's fixed
width from the same factor — its **font size never changes**, because that is a size
preset and not a geometric property (TC-23, which measures the group's effective scale
from the note's own box growth rather than from drag arithmetic, since story 7's
`clampScale` / `anchoredBox` legitimately adjust a requested factor).

## e2e: counting painted lines
`Range.getClientRects()` is per **text run**, not per line: a wrapped line whose trailing
space hangs at the margin yields two rects, so a 300 character annotation that paints 5
lines reported 9. `paintedLineCount` counts distinct rounded `rect.top` values among the
non-empty rects, which is the number of painted line boxes — the honest thing to compare
against the stored height.

## e2e: knowing which object your own click made on a busy board
`createTextWithTool` used to diff the ids on screen before and after the click. With five
people clicking at once that is wrong: somebody else's object can replicate in between and
be mistaken for yours (which is how TC-30 ended up with two people typing into one heading
and one heading of four characters). It now reads the id from the element that holds the
focused editor (`document.activeElement.closest('[data-text-object-id]')`).

## e2e: eventual consistency, asserted as such
TC-29 compares the two documents by polling a function that reads **both** and returns a
value only once they agree (`expect.poll(() => bothDocsAgree()).not.toBeNull()`), because
polling one replica against a string read from the other once just loses a race against
replication. What it then asserts is story 3's promise, unchanged: the same character
multiset as what was typed, no more and no less, with the words allowed to interleave.

## Naming
Toolbar buttons carry `data-testid="select-tool"` / `"text-tool"` (the design's
`toolbar-text-tool` shorthand, shortened to match the existing `select-tool` pair), the
object is `text-object-<id>` with `data-text-object-id` for the generic selectors stories
7 and 8 already use, and the editor is `text-editor` — distinct from `sticky-note-text`,
so a test can tell the two kinds of box apart when both are on screen.

## Snapshot API
`objectSnapshots(doc)` is what the board renders: every known type as a generic
`ObjectSnapshot` (sorted by `z, id`). `snapshot(doc)` is left sticky-only, because story
2's tests read it as "the notes"; `allObjectIds` / `objectBounds` / `objectSnapshots` are
what the selection, marquee and transform code walk, which is why a text object got
stories 7 and 8's behaviour without either story being touched.

## A pre-existing race in story 3's TC-25, exposed by this story's extra e2e load
`live-collaboration.spec.ts` TC-25 polled Sam's screen until the note had *moved*, then
compared Sam's position with Alex's once. A drag writes a position per frame, so the
first update to arrive can be a mid-drag position while the last one is still in flight,
and the compare then compares two different moments. This reproduced on the commit before
story 9 started (3 of 6 runs with the file's own `--repeat-each`, more under load) — the
story 9 spec just makes the machine busy enough to show it regularly. The assertion is
now polled until the two boards agree instead of read once, using the file's own
`expectEventually` and its propagation guard; the promise is the same (the two screens
must agree on where the note is), the timing log is still printed, and a board that never
agrees still fails. Nothing was removed and no threshold was loosened.

# Story 11: sketch freehand with a pen

## The undo boundary goes before the write, not after it
`design.md` says "stopCapturing after each commit", and a literal reading of that loses strokes:
`Y.UndoManager` merges consecutive transactions into one undo stack item *until* `stopCapturing()`
is called, so a stop placed only after a write closes the window that the *next* write will open.
A sticky note created a moment before a stroke, then one undo, and the note comes back with it.
`PenTool` calls `undo.boundary()` first and then writes, which is the convention the rest of the
board already uses: two strokes are `stop → write₁ → stop → write₂`, which groups exactly the way
the design's own state diagram wants.

## Two readouts of a stroke's points, on purpose
`scaledPoints(s)` returns points in the **box's own units** (origin at the box's top-left, scaled by
`width / baseWidth` and `height / baseHeight`); `strokePolyline(s)` returns the same line in **board
units**. They cannot be one function: the first is what the `<svg>` draws inside its `viewBox` (which
is what makes a resize scale a drawing instead of sliding it), and the second is what
`distanceToPolyline` measures for a hit test, which has to be in the coordinate space the press was
converted into. TC-06's "coordinates doubled when the box doubled" is a statement about the first;
TC-15's five pixels is a statement about the second.

## A stroke's box is not a target, in the model or in the DOM
`objectAtPoint.ts` now excludes strokes from its box test, for the same reason connectors are
excluded: a squiggle's bounding box is mostly empty board, and a box test would let a press beside a
line select it. The DOM says the same thing — the wrapper is `pointer-events: none` and only the two
paths take presses — and the two agree by construction: the registry's tolerance is
`max(thickness / 2, STROKE_HIT_TOLERANCE_PX / zoom)` and the hit path is painted at twice that, so
"this press is on the drawing" cannot mean one thing to the browser and another to the model.

## The preview is painted imperatively, and React only mounts the SVG
PenTool keeps the recorded points in a ref and, once per animation frame, sets
`path.setAttribute('d', smoothPath(...))` directly. Re-rendering React per pointer event would put a
5,000-point path through the reconciler 60 times a second for a line that is going to be thrown away
a moment later; and the *reason* the stroke is not in the document while it is being drawn (an
unfinished object on everybody else's board, in everybody's undo history) is the same reason its
pixels should not go through the component tree either. React's involvement is one boolean: whether
the SVG exists. Coalesced points come from `getCoalescedEvents()` when the browser offers them, which
is the difference between a line and a polygon on a fast drag.

## One wheel rule, in `toolSurface.ts`
`wheelPixels()` / `wheelInputFromEvent()` moved out of `BoardViewport` so `PenTool`'s "forward what
the pen is not for" path uses the same `deltaMode` conversion (lines vs pixels vs pages) the board
uses. Duplicating it would mean two places to get the conversion wrong, and TC-19's "the board pans
under the pen" would pass in one and not the other.

## Component tests dispatch coalesced bursts, not single moves
A 5,010-point drag delivered as 5,010 individual `fireEvent`s is 5,010 preview repaints in jsdom and
took 5.6s for TC-12 alone. `moveThrough` now delivers 250 points per dispatch with a synthetic
`getCoalescedEvents()` — which is what a real browser does: one `pointermove` per frame, the
intermediate points inside it. Same coverage, same code path, TC-12 under a second.

## e2e: sample the preview from inside the page's frames
`design.md` asks for the preview's `d` measured "on consecutive animation frames". Reading it between
two Playwright calls measures it whenever the browser got round to it, which is not the same claim, so
`startPreviewSampler` installs a `requestAnimationFrame` loop in the page, the drag gives the pointer
one frame per point, and the test asserts on what the page itself saw: a path painted on almost every
frame, repainted with more than three distinct shapes as the pointer went on.

## e2e: a fixture is sampled at a hand's rate, and the box is computed from what was moved
Each `page.mouse.move` is a round trip, so replaying a 320-point recording at two steps each was
enough to push TC-17 over the test timeout. The fixtures are now sampled every 5th or 6th point — a
real pointer reports tens of points a second, not hundreds — and the box a stroke is stored in is
asserted against the extent of the points that were *actually* moved through, not against the full
fixture. That keeps the assertion honest at any sampling rate.

## e2e: this Playwright has no `toSatisfy`
Numeric "within n of" assertions go through `deviation(actual, expected)` and a `toBeLessThan`, which
reads better in a failure message anyway ("the drawing is as wide as the pointer went: 3.4 ≥ 2").

## A pen in one hand is not a pen in every hand, and the e2e says so
TC-18's watcher holds no pen at all: his screen has no `pen-toolbar`, while the drawer's has. That is
`pen.options`' session-only rule showing up as a real absence on a second browser, which is a
stronger statement than the component test's "the other tab's state did not change".

## Single-quoted test titles cannot contain apostrophes
`it('a drawing's box…')` is a parse error in the vitest transform (esbuild), reported as a syntax
error on a line the test title is not on. Rephrase, or use double quotes for titles that need an
apostrophe.

## Firefox and WebKit still cannot launch here (TC-17's second half is blocked)
`E2E_BROWSERS=chromium,firefox,webkit npx playwright test pen.spec.ts --grep TC-17` launches both and
both die at start (`Abort trap: 6` out of `pw_run.sh`, exit 134) before a page exists. Chromium's
TC-17 passes. This is the same machine limitation noted for earlier stories, not something this
story introduced or can fix; the run is recorded rather than skipped silently.

---

# Notes — story 12 (Drop images onto the board)

## The two addresses, and what each one is allowed to say
`POST /api/boards/:boardId/assets` answers `201 {assetKey, contentType, url}` — the design's contract
plus `url`, which is the address the Worker just built. A client that assembled its own would have to
agree with the server about the prefix, and one field costs less than that argument. Board existence is
asked over the Durable Object RPC (`boardExists`) rather than answered locally: story 5's object is the
thing that knows whether a board was ever created, and an endpoint that says "stored" about a board
nobody made is a hole in the board list. A malformed id takes the same path — a 404 without touching the
namespace is an optimisation, not a correctness win, and going through one code path means one rule.

## The body is measured, never believed
The 10 MB rule is enforced on bytes *read*: `request.arrayBuffer()` in workerd enforces no limit, and a
body read as a stream has no size until it has been read. So the reader stops at `limit + 1` and
refuses if a byte exists past the limit. `Content-Length` is treated the same way — as a claim: if the
bytes stop short of the claimed length the request is refused without being stored (TC-12's second
half), because a client that lies about size will also lie about what it is sending.

## Sniffing is the only type check, and it lives in shared code
`sniffImageType` is in `src/shared/image-format.ts` because three runtimes have to reach the same
verdict about the same bytes: the browser (before it uploads a file the board will refuse), the Worker
(before it stores anything), and the tests (before they trust either). Two traps in it, both found the
hard way:
- A GIF's magic is six bytes and the interesting character is at **index 5** (`87a`/`89a` — index 3 is
  the `8` in both). Sniffing `head[6]` accepts random bytes that happen to start `GIF8`.
- A JPEG needs SOI *and* a following marker (`0xFF` + `0xE0..0xFE`): `FF D8 FF` is what a truncated
  header looks like, and it is not a picture.
SVG is refused by looking at the text (`<svg` inside the first bytes), because an SVG *is* XML that
claims to be a picture, and a picture that can carry a script is not a picture. A truncated PNG is
**stored**: sniffing is not decoding (TC-14's row in the design's matrix), and only a decoder is
entitled to say a file is corrupt — which is why the client's `createImageBitmap` decode is the place
that decides, and why a file that decodes to nothing never becomes an object.

## Serving is a header set, and the bytes are re-checked on the way out
`Content-Security-Policy: default-src 'none'` plus `x-content-type-options: nosniff`, and
`Cache-Control: public, max-age=31536000, immutable` because a key is permanent. The `contentType`
stored in R2's `httpMetadata` is a string some previous writer chose, so the type a visitor is served is
decided from the bytes again: an object whose metadata claims `image/png` and whose first bytes are
`{` is answered 404 rather than served (a stored JSON invoice is not one of our pictures).
`If-None-Match` and `HEAD` need no code: passing `request.headers` to `bucket.get()` lets R2 answer 304
itself, which the integration tests assert rather than assume.

## Upload status is document state, written with an origin that undo ignores
`status`, `uploadStartedAt` and `uploaderId` are ordinary fields on the object's `Y.Map`, so story 3
relays them like a move or a colour and story 4 persists them like anything else. Writing them goes
through `UPLOAD_ORIGIN`, **not** `LOCAL_ORIGIN`: `Y.UndoManager` filters by *origin*, not by author, so
if an upload's completion were tracked, a colleague's Retry could be undone by my Ctrl+Z — which is the
thing story 12's "undo only ever rewinds your own steps" forbids. `markImageReady` checks the object
still exists **inside** the transaction: deleting a picture while its bytes are in flight is allowed,
and the answer is "there is nowhere to put this" (`false`, no update) rather than a resurrected object.

## Sizes, and where the rounding goes
`placementSize` scales by `min(1, MAX / maxDim)` and rounds **after** multiplying. Writing
`Math.round(w / (maxDim / MAX))` looks the same and is not: with `maxDim / MAX = 2` it is exact, but any
inexact intermediate division turns 1600x1200 into a 799-wide box that no longer matches the picture. A
1x1 picture stays 1x1 — the smallest size the world allows is a rule about *dragging*, and the PRD says
a one-pixel picture arrives at one pixel.

## The row is boxes, not objects
`layoutRow(sizes, origin, anchor)` returns `{x, y}` per box so it is testable without a `Y.Doc`, and the
anchor maths is `placement - size / 2` for a centre. (Writing `placement - size` put three dropped
pictures half a box up and left of the pointer — the component test that dropped files at the view
centre caught it because the boxes were off-screen.)

## Three doors, one hallway
Drop, paste and the file picker all funnel into a single `addFiles`. The only difference between a drag
and a paste is where the files are hanging off the event, so `eventFiles` reads
`dataTransfer ?? clipboardData`. Two rules that only show up when you try them:
- `preventDefault()` only when the drag actually carries files. A drag of selected text or a link onto
  the board must keep behaving as before, and a board that eats every drop is a board that broke
  someone's day.
- "Am I typing somewhere?" is `isTextEntryTarget`, and the **hidden file input is a text field as far
  as that helper is concerned**. Pasting into the picker's own dialog was suppressed by the rule meant
  for the text editor; the exclusion is `closest('input[type=file]')`.

## The offline gate refuses two states, not three
`reconnecting` and `load_failed` are refused with the PRD's sentence; `connecting` is **not**. The
design's TC-19 names `reconnecting` only, and a board that has just been opened sits in `connecting`
for a few hundred milliseconds — refusing a drop then would fail the golden path of the story and would
contradict story 3's own rule that "not arrived yet" is not an error. The gate is in `addFiles`, so all
three doors inherit it, and the toast is deduplicated by text: twenty oversized files say one sentence.

## Upload progress is XHR, coalesced, and silent at both ends
`fetch` has no upload progress; the design names `upload.onprogress`, so `uploadImage` is an
`XMLHttpRequest`. Twenty files uploading at once produce dozens of progress events a second, so the
fractions land in a ref `Map` and at most one React update per animation frame is published — a
placeholder that re-renders per byte is a board that has stopped being responsive. `progressOf` returns
`undefined` for a fraction ≤ 0 or ≥ 1: "no bar at zero and at complete" is a rule in one place rather
than an absence in three.

## The placeholder is the object's box; the buttons are its siblings
Two DOM facts this story had to learn from the outside in:
- An absolutely positioned element with no `inset` shrink-wraps to its content. The placeholder used to
  sit in the top-left corner of an 800x600 picture's area with "Uploading…" in a box the size of the
  word; it is `inset: 0` now, which is what "the picture arrives at the size it will be" means.
- The placeholder box is `overflow: hidden` (its label must not spill over the board), and the control
  row on it is counter-scaled by the zoom — so at a small enough zoom the row is bigger than the box,
  gets clipped, and **a clipped button cannot be clicked**. The row is therefore a *sibling* of the
  placeholder, inside the object's own (non-clipping) div, anchored bottom-centre; bottom-centre stays
  inside the box at every zoom where any part of the box is on screen, which top-left is not.
A finished picture that goes back to uploading (a Retry) gets a new `key`, because a browser that has
already given up on an `<img>` does not change its mind when the same element gets a new `src`.

## The picture wins when box and bytes disagree
`objectFit: contain`. In the ordinary case the box was made from the picture and the two agree exactly;
`fill` would mean that any box that ever disagreed — an older document, a group resize clamped on one
axis — *stretches* the picture. That is cheap insurance for the sentence "resizing never distorts a
picture".

## `I` is not a tool
The PRD's request is "press I and choose a file", which is one action, like `N` for a new note — not a
mode. `ToolId`, the toolbar's selection state, the cursor, the object-creation switch and the tests of
stories 8 to 11 all stay exactly as they were, and the key opens the picker through the same
`onPickImage` the toolbar button calls.

## One toast component, and no toast for a failed upload
`useToasts` + `ToastStack` (in the design's `src/client/ui/Toast.tsx`), deduplicated by text, five
seconds, `role="status"` / `aria-live="polite"`. A *failed upload* deliberately gets no toast: the box
on the board already says "Upload failed", and a message that repeats the box is a second thing to
notice and dismiss. The four toasts that exist are exactly the PRD's four pre-flight sentences.

## Upload state does not go through `ObjectProps`
`ObjectProps` is what every object type receives. Upload status, progress, retry and "who uploaded
this" belong to pictures alone, so `ImageControlsContext` carries them and `ImageObjectView` reads it.
`ObjectProps` is unchanged, which is another way of saying no other object type pays for this story.

## One change to another story's behaviour: a ratio-locked resize clamps to one scale
`clampScale` clamps each axis separately, which is right for a box that may change shape and wrong for
one that may not: a note twice as wide as it is tall hits the size floor on its **height** at half the
scale its **width** does, so the two halves of the same drag stopped at two places and the result was a
square — the minimum honoured and the one property the type is locked to thrown away. Story 12 found it
by resizing a wide picture to the floor (TC-27). `useTransformGesture` now collapses the two clamps into
one factor for any aspect-locked gesture (sticky, shape, image, and any group containing one): whichever
axis runs out of room first stops the drag and the other comes with it.
Consequences, both deliberate:
- `tests/component/Transform.test.tsx` gains a test for the invariant itself (a 400x200 note dragged
  through the floor ends 50x25, never 16x16) — it is a gesture rule, not a picture rule, so it is not
  labelled with a story 12 TC id.
- Story 9's `TextObject.test.tsx` TC-23 measured a group scale that the old per-axis clamp produced in
  two different amounts (its `growY > 1.5` was the *text object's minimum height* inflating the group's
  y-scale). The drag is now 200 units instead of 100, both axes are asserted to have grown, and the test
  gains an assertion the old behaviour would have failed: `growY` equals `growX`.

## Fixtures: built once on disk, built again inside workerd
`tests/fixtures/images/generate.mjs` is the one-time generator, committed, with the nine files it made
committed as data. Writing a GIF that a real browser decodes was not a hand-job: the "uncompressed GIF"
trick (emit every code literally, skipping the first code after each clear code and incrementing the
table by one per code, bumping the code size when the next code reaches `1 << width`) produces a
decodable animation in about forty lines. Because the integration suite runs **inside workerd**, where
there is no filesystem, the same builders live in `tests/fixtures/image-bytes.ts` with no `node:fs` in
sight — the e2e suite reads the files off disk, the integration suite calls the builders.

## This repo's `Buffer` is not Node's `Buffer`
`@cloudflare/workers-types` declares a global `Buffer` whose `toString()` takes no arguments, and the
tsconfig that covers `src/` also covers `tests/`. So base64 in this repo's test code goes through chunked
`btoa` / `atob` helpers (`base64Of`, `bytesOfBase64` in `tests/e2e/helpers/drop-files.ts`) — anything
else typechecks in the test project and fails in the worker project, or the other way round.

## Files in a browser that has no desktop
There is no OS-level drag-and-drop to automate, and Playwright's own drag helpers carry no `File`s, so
`dropFiles` builds a real `DataTransfer` holding real `File`s (from the real fixture bytes) inside the
page and dispatches `dragenter` / `dragover` / `drop` **at the element under the point**
(`document.elementFromPoint`), which is where a browser sends them. The same helper is used for paste.
One honest absence: TC-25b does not assert the `dropEffect = 'copy'` cursor in a real browser, because
Chromium hides `dataTransfer.types` from a page until a *user* has dragged files into it — a synthetic
drag reports an empty list (the test proves it: `typesOfDrag` says 0 in the same instant that dropping
the same event's files creates three objects). The hover half of TC-25b is asserted at component level,
where the drag is ours.

## The five-minute rule, tested in a second
TC-28b holds the upload with a route that never answers — so the picture is genuinely, not
pretendingly, mid-upload — then installs Playwright's **API clock**, runs it forward past
`IMAGE_UPLOAD_STALE_MS` and resumes it immediately. Installing it *after* the drop is deliberate: the
initial sync and the upload's own bookkeeping run on real time first, and resuming at once is what keeps
Playwright's actionability checks (which wait on animation frames) from hanging on a frozen clock.
`useUploadClock` re-measures `Date.now()` while any upload is in flight — every 60 s in production,
every 1 s under `MODE=test`, where the wait costs nothing and the test proves the clock is the thing
that flips the state, not a re-render someone happened to cause.

## The picker's `accept` names suffixes as well as MIME types
A list of bare MIME types makes Firefox show "Custom file" in the dialog's filter line. The PRD's
sentence is about what the dialog offers, so `IMAGE_INPUT_ACCEPT` carries both forms (`image/png,.png`,
…), MIME types first so browsers that can use names show names.

## Only Chromium launches here, as in stories 1 to 11
Same sandbox limitation, recorded rather than hidden: `E2E_BROWSERS=chromium,firefox,webkit` starts both
extra browsers and both die before a page exists. Nothing in the image specs uses an engine-only API
(`page.route`, `page.clock`, `setInputFiles`, `data-testid`), and the `accept` suffixes above are in
place for the browser that cannot run here.

## Timings (logged, never asserted)
Drop of three screenshots → three pictures painted on another person's screen: **83 ms**
(`LIVE_UPDATE_LATENCY_BUDGET_MS` is 1000 ms; the test fails past a 2 s propagation guard).
## An id-ordered list is not a drop order (a flake this story's own suite taught me)
`imagesOn(page)` sorts by **id**, on purpose: two people's screens have to be comparable without the order
their updates arrived in being part of an assertion. It meant that reading `ready[i]` against `files[i]`
in TC-25 was asserting a coincidence — with three files it held one time in six, and it failed the run
where it did not, looking exactly like a board that had stored a WebP under a PNG's address. Nothing was
mispaired in the product (`startUpload(id, file)` closes over both, and the key it writes is the answer to
that request), so the fix is in the assertion: each served picture is now matched to a dropped file **by
its bytes**, and the test asserts that the three served pictures are the three dropped files as a
permutation, each under its own key, each served as the type its own magic says. Because an unordered
list can also hide a real mispairing, the invariant the e2e can no longer state is stated where it can be
seen: `tests/component/ImageInsert.test.tsx` answers three uploads **backwards** and checks each object got
the address its own file's request returned, identifying the object by the pixel size that file decoded to.
