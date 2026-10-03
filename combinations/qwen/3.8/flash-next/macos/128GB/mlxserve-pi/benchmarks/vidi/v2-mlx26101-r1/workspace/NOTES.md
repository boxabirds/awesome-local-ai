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
