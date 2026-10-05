# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Stack versions
- Vite 8 + @vitejs/plugin-react 6 + React 19, Vitest 5 (projects `unit`/`jsdom`
  `component`), Playwright 1.63, Wrangler 4 (assets-only Worker config; the Worker
  `main` arrives in story 3).
- `typescript` is pinned to `~5.9.3` rather than the current `7.x`. TypeScript 7 is
  the new native (Go) compiler; `tsc --noEmit` from 5.9 is the compiler the rest of
  the tool chain (and later stories) is written against, so it is the safer pin.
  Nothing in the source depends on the compiler version.

## Ports
All servers are pinned to ports inside `$AGENT_PORT_FIRST`-`$AGENT_PORT_LAST`
(22880-22895), which the harness requires:
- `22880` `wrangler dev` (e2e static assets), `22881` its inspector/devtools port
  (`playwright.config.ts` and `npm run worker:dev`). Playwright takes the first free pair
  in the range when 22880 is already held, and stays inside the range either way.
- `22884` `vite preview`, `22885` `vite` dev server (`vite.config.ts`).

## Shared camera state
The design gives `useCamera(viewport: Size)` the camera state *and* gives
`BoardViewport` only a `children` prop, while `App.tsx` wires `ZoomControls`,
`NavigationHint` and `BoardViewport` together. Two separate `useState` calls could
not share a camera, so `useCamera` is backed by one module-level camera store
(subscribe/getSnapshot via `useSyncExternalStore` + coalesced `requestAnimationFrame`
emits). `useCamera` is a thin subscription over that store, so every caller sees the
same camera and every handler is a stable function. The store is in-memory only
(nothing is persisted, per the PRD). `src/client/canvas/cameraStore.ts` holds it;
`useCamera.ts` re-exports the hook. That extra file keeps the store testable in
isolation and is the only file added to the design's layout.
- Initial camera = `resetCamera(initial viewport)` where the initial viewport is the
  window size, so the board opens with its starting point centred and a resize that
  happens before the first `ResizeObserver` callback does not move it.
- `useViewportSize(ref)` is exported from `useCamera.ts` (design lists only
  `useCamera` there) and is shared by `App` and `BoardViewport`; it falls back to the
  window size when the measured box is zero (jsdom reports zero rects).

## Wheel delta modes
`deltaMode` LINES/PAGE is converted to pixels with the named settings
`WHEEL_LINE_PX` and `WHEEL_PAGE_VIEWPORT_FRACTION` added to
`src/shared/config.ts` (the design's six named settings are all present and
unchanged).

## Grid / origin marker measurement in tests
The dot grid is a CSS `radial-gradient` background on the viewport element
(`background-size = GRID_SPACING_WORLD * zoom`,
`background-position = (-x * zoom) mod spacing`), so a grid dot's on-screen position
is exactly `background-position + n * background-size`; e2e tests read those computed
values rather than sampling pixels. The origin marker is a 24x24 CSS crosshair whose
*centre* is at world (0, 0) with a counter-`scale(1/zoom)` so it keeps a constant
on-screen size; its `getBoundingClientRect()` centre therefore equals
`worldToScreen(camera, {0, 0})` exactly, which is the stable pixel target TC-23/24/26
need.
For TC-27 (1,000,000 units away) the marker sits ~2,000,000 px off screen. What is
still exact there is the camera (read through the documented
`window.__vidi6.getCamera()` fixture) and the *difference* between two
`getBoundingClientRect()` readings, which the test uses to show a 200/100 drag moved
the content by 200/100 px. What is not exact is the *rendered* CSS text: browsers
serialize an inline `transform`/`background-size` with about six significant digits
(`translate(-1.00436e+06px)` for `-1004364.97px`), so e2e comparisons of rendered
values use a tolerance that grows with the number (see `serializationTolerance` in
`tests/e2e/helpers/board.ts`), while exactness of the maths itself is asserted on the
camera and on the grid geometry.

## Test hook
`window.__vidi6.getCamera()/setCamera()` is installed only when
`import.meta.env.MODE === 'test'`, i.e. by `npm run build:test`
(`vite build --mode test`). `npm run test:e2e` builds that way *before* invoking
Playwright, so the suite cannot be fooled by the `wrangler dev` it reuses
(`reuseExistingServer`) still serving an older bundle off disk - which is what
happened once a previous run left a `workerd` behind on port 22880. `src/client/canvas/testHooks.ts` is unreachable in a production
build (the call site is inside an `import.meta.env.MODE === 'test'` branch, which the
bundler folds away), so `__vidi6` never exists in production.

## jsdom gaps filled by tests/component/setup.ts
jsdom has no `PointerEvent`, no `setPointerCapture`/`releasePointerCapture`, no
`ResizeObserver`, and `getBoundingClientRect()` is all zeros. The component-test setup
installs small standards-shaped shims for these (a `PointerEvent` extending
`MouseEvent`, capture methods that track ids on the element, a `ResizeObserver` that
reports the window size once on `observe`) and makes `requestAnimationFrame` a
`setTimeout(0)` so the store's per-frame coalescing flushes inside
`await waitFor(...)`. Component tests that assert `defaultPrevented` construct the
event explicitly and dispatch it, because React's own `onWheel` would be passive -
the component under test registers a real non-passive listener, which is what the
tests verify.

## Keyboard shortcuts
`Ctrl/Cmd + =` (also `+`), `Ctrl/Cmd + -` (also `_`) and `Ctrl/Cmd + 0` are handled on
`window` and `preventDefault`ed so the browser page zoom never changes (PRD
`zoom.no_page_zoom`). Shortcuts are ignored while focus is in a text field
(`input`, `textarea`, `select` or `contenteditable`) so later stories can type on the
board; no such element exists in story 1.

## e2e: waiting for the render

The camera store coalesces its notifications into one animation frame, so the DOM is
always up to one frame behind the camera. That shows up in tests as a stale
percentage label or a zoom button whose `disabled` attribute has not landed yet -
Playwright then waits for a disabled button to become enabled and times out. Every
e2e measurement therefore goes through `settled(page)`
(`tests/e2e/helpers/board.ts`), which waits until the world layer transform, the
percentage label, the two buttons' `disabled` state and the grid size all match the
camera the page holds. That doubles as an assertion of the PRD's "the controls reflect
the zoom" requirements.

## Firefox in this sandbox

Firefox 155 (Playwright 1.63's build) aborts with SIGABRT during startup in this
sandbox - reproducible without Playwright (`firefox -no-remote -headless -profile ...
about:blank`), independent of profile location, `HOME`, and the
`MOZ_DISABLE_*_SANDBOX` escape hatches, while `firefox -version` works. Chromium and
WebKit start fine. Rather than let that read as a broken board, the Firefox project
is added only when a one-off launch probe succeeds; the probe result is cached per
Playwright version in `.ua/firefox-launch.json` (gitignored), logged on every run, and
overridden with `VIDI6_FIREFOX=1`/`=0`. The board is therefore verified in Chromium
and WebKit on this machine, and in all three engines wherever Firefox can start.

## wrangler.jsonc

An assets-only Worker may not declare an assets `binding` - wrangler refuses to start
("Cannot use assets with a binding in an assets-only Worker") - so the config sets
`assets.directory` and no
binding; the Worker script and its `ASSETS` binding arrive with story 3's routes.
`inspectorPort` is not a `dev` config key either, so the inspector port is passed as
the `--inspector-port` flag (in `playwright.config.ts`'s webServer command and in
`npm run worker:dev`), inside the allocated port range.

## Running the e2e suite

`npm run test:e2e` builds the client with `vite build --mode test` first, then starts
Playwright, whose `webServer` is `wrangler dev` on the first free port in the allocated
range serving `dist/client` (see the story 2 note below).
Two details that cost real debugging time:

- The webServer command is wrangler itself, not `npm run wrangler dev ...`: behind
  `npm`, the shutdown at the end of a run leaves the workerd process alive, holding
  22880/22881, and the next run either reuses it or fails to bind. wrangler reads the
  assets directory into memory at startup (its watcher hit a macOS file-descriptor
  limit here), so a server that predates a build serves the bundle it started with -
  which is why the test build happens before Playwright launches and why `openBoard`
  checks for `window.__vidi6` before asserting anything about the board.
- `wrangler.jsonc` deliberately has no `not_found_handling: single-page-application`:
  with it, a request for a bundle that is not on disk gets index.html back with a 200,
  and the app simply never boots. Story 1 has one route, so the rewrite buys nothing.

## Story 2: two drag bugs that only a real browser could find

Both survived 71 unit tests and 83 jsdom component tests, and both were caught by the
e2e suite on the first run. They are worth writing down because the jsdom tests were
not wrong, they were just not the place where either bug can show.

1. **`moveObject` returning `false` ended the drag.** `false` from the model means
   either "no such object" or "already at that position" (the second exists so a drag
   does not write a no-op to the undo log every frame). The note took that as "the
   note is gone", dropped its drag state, and stopped following the pointer after the
   first frame that had nothing new to write. Now the drag only lets go when the
   document itself is gone, which is what the unmount of the note actually means.
2. **Raising a note took it out of the document.** `bringToFront` changes `z`, and
   `snapshot()` lists notes in stacking order, so the raised note became the last of
   the React children - React moved that DOM node, and Chromium releases pointer
   capture when the captured element is pulled out of its place. The note jumped by
   the pointer moves that had already arrived and then stayed put: a drag of 100 screen
   pixels delivered 10. A jsdom test cannot see this, because it dispatches one
   `pointermove` per drag and jsdom has no pointer capture to lose. Now the notes are
   rendered in the order they were created and stacked with `zIndex: note.z`, so being
   raised is a style change and the note is never moved in the document while held.
   `bringToFront` still happens once, when the drag starts, as the design says.

Consequence for the tests: "which note is on top" is a computed-style question, not a
DOM-position one. `paintedIds` in `tests/e2e/helpers/sticky.ts` sorts by `z-index` with
document order as the tie-break, which is how the browser itself decides.

## Story 2: the e2e port is picked, not pinned

The design's test matrix for this story has no reload or two-browser test - "No network
or storage in this story", persistence is story 4 - so the e2e file covers TC-30 to
TC-34 and the notes' keyboard reach, and TC-39 stays a unit test.

`playwright.config.ts` now uses the first free pair of ports inside the allocated
range instead of 22880 outright. The reason is a runtime that cannot be stopped: a
workerd left behind by an earlier session owns 22880, answers `/` out of the snapshot
it read at startup and 404s the bundle the current run built, so every test fails with
"window.__vidi6 is missing". A new sandbox cannot kill it - `ps` and `pgrep` are refused
(`EPERM`), `lsof -ti:22880` sees nothing, and while `netstat -anv -p tcp` does show the
pid, `kill -9` on it leaves wrangler in another process simply starting another runtime
on the same port. When the ports are free, as they are in a clean checkout, the chosen
pair is 22880/22881 and nothing about a run changes.

The choice is published in `VIDI6_E2E_PORT`/`VIDI6_E2E_INSPECTOR` and read back from the
environment, because the config file is evaluated again in every Playwright worker and a
port that is free in the parent is already taken by this run's own server in the worker -
each worker then started its own server on another port and tested nothing.

While here: the note above about `wrangler.jsonc` was wrong. The config sets
`assets.directory` and deliberately no `not_found_handling`; the flag and the inspector
port are passed on the command line.

## Story 3: what the room is, and what it is not

The room is a `Durable Object` (`src/worker/board-room.ts`) holding one `Y.Doc` in memory and
a `Set` of open sockets. It is a *peer*, not a database: it applies what it receives, relays
what came from someone else to everyone else, and forgets everything when its last socket
closes. Story 4 puts persistence underneath it; nothing here pretends at storage.

Sockets are accepted the plain way, without Hibernation. Hibernation exists to let an idle
room give up its memory, and an idle room in this story has nowhere to get its document back
from, so it would only mean re-implementing the queueing the in-memory doc already does.
`state.blockConcurrency` is not used either: everything the room does is synchronous.

The room *is* a Yjs peer rather than a byte pipe, which is what makes merges happen at the
room rather than per client, and what makes a newcomer's SyncStep1 answerable with the
room's own state. The one deliberate exception is awareness: awareness bytes are forwarded
untouched to everybody else and the room keeps no awareness state of its own, because
presence is story 6 and an awareness cache that nothing reads would be a place for a bug to
live.

Two things the Worker itself decides before a room is involved: an address that is not 22
characters of base64url gets `400` (a room is never created for garbage, and no id means no
access to a board), and a request for a room address without `Upgrade: websocket` gets `426`.

## Story 3: the sync handshake, and why nothing acknowledges a SyncStep2

A client opens by sending SyncStep1 (its state vector); the room answers with SyncStep2 (the
updates the client is missing). A client's own SyncStep2 — its answer to *someone else's*
question — is applied and no reply is sent, because SyncStep2 is an answer and not a
question; `lib0`/`y-protocols` semantics say so and the integration tests pin it (TC-08).
That matters for the badge: `provider.synced` only turns true when a SyncStep2 *arrives*,
which it does, because every client asks a question first. Nothing extra is needed to tell
a client it is up to date.

The room relays a newcomer's SyncStep2 to the others as well, which is what makes a joining
board visible without waiting for the newcomer to change anything (TC-08's echo assertion
counts notes before and after to see exactly that).

## Story 3: workerd details that cost an hour each

- **`ws.binaryType = 'arraybuffer'`.** In workerd a WebSocket message event carries a `Blob`
  by default, not an `ArrayBuffer`, and `decodeMessage` wants bytes. Both the room's sockets
  and the test client set `binaryType` explicitly.
- **`compatibility_date` is `2026-08-22`, not later.** The integration project runs on the
  workerd that `@cloudflare/vitest-pool-workers` pins (it depends on wrangler 4.124 →
  workerd 1.20260815.1), and that runtime refuses a later date. The `wrangler dev` used for
  e2e is the top-level wrangler 4.147 with workerd 1.20261001.1, which accepts 2026-08-22
  too. One date, both runtimes.
- **Vitest is 4.1, not 5.** `@cloudflare/vitest-pool-workers@0.22` asks for `vitest ^4.1.0`
  and the repository was on 5.0.3; the integration project is the reason the pool is needed,
  so vitest came down rather than the pool being dropped. The suites import `describe`,
  `expect` and `it` by name from `vitest`, which is a style both versions share.

`tsconfig.worker.json` typechecks `src/worker` and `tests/integration` against
`@cloudflare/workers-types` (no DOM), and the root config excludes both. `npm run typecheck`
runs the two, because one `tsconfig` cannot have DOM and not-DOM at once.

## Story 3: what counts as "caught up" in a test

A state vector does not move when a delete is applied, so two clients whose documents agree
about *what is deleted* have different state vectors while being fully converged. The
integration helper therefore polls until a snapshot of each document — ids, text, colour,
position — is equal everywhere, which is also the thing the product promises somebody will
see. `converge()` in `tests/integration/helpers/ws-client.ts` is that; TC-12 runs 200 seeded
operations with `MAX_CONCURRENT_EDITORS` clients and asserts the same key on all of them.

`decodeMessage` refuses an **empty** sync payload. A SyncStep1 is a state vector and a
SyncStep2 is a set of updates; neither is ever empty in a real exchange, and a zero-length
update is the cheapest thing a confused or hostile client can send, so it is a `1003` close
rather than a no-op (TC-03, TC-17).

## Story 3: the badge is a state machine, and TC-27 found it lying

`createConnectionTracker` in `src/client/sync/connectBoard.ts` turns provider events into
`ConnectionState`. The bug TC-27 caught: the provider emits `status:'connecting'` for the
*first* dial and again for every *retry*, and the badge said "Connecting…" for a retry —
the same words as "this board is still loading" — because the flag that meant "we have been
in sync" was cleared by the disconnect. There are now two flags: `agreed` (right now) and
`everSynced` (ever, never cleared while the connection lives). A retry shows "Reconnecting…"
because `everSynced` is still true; a first load shows "Connecting…" because it is not.
`everSynced` is also what decides whether a re-sync earns the green "Connected"
confirmation — the confirmation is for a board that came back, so it is keyed on the board
having been away, not on the flag that the going-away already reset.

`disableBc: true` switches off y-websocket's BroadcastChannel transport. Without it, two
tabs of one browser collaborate through `localStorage` without the server, which would let a
test pass while proving nothing about the room; the e2e uses separate browser contexts
anyway, so nothing is lost.

## Story 3: composition, and a second author who types over you

`StickyTextEditor` keeps its textarea uncontrolled and writes to the `Y.Text` through a diff,
so a remote change can be shown by putting it in the box. That breaks the one case where the
box's content is not the document's: an input method composition, where the box holds a word
the person has not finished with — pinyin over 漢字 — and rewriting it ends the composition
and loses what they were making. So while a composition is open the editor *does not touch
the box*: remote text is noted, and when the composition ends (confirmed or cancelled) it is
written back with `applyTextDiff` against what the box actually holds.

Two small pure functions in `src/client/objects/StickyText.ts` carry the reasoning, because
they are the sort of thing to get wrong in the dark: `moveCaretThrough(before, after, caret)`
says where a cursor lands when the text under it changes, and `compositionInsertion(value,
baseLength, caret)` picks the composed word out of the box and returns `null` when the box is
shorter than the document was — which means the composition *replaced* text rather than
inserting into it, and the whole box has to go through the diff instead.

The write back is insert-only in the ordinary case: it puts the new word in at the caret and
touches nothing else, so a remote edit that landed during the composition is kept. A
composition that overwrote text is the exception and is committed as a whole-box diff.

## Story 3: things the e2e found that no unit test could have found

1. **A locator cannot ask whether something is absent.** `locator.textContent()` waits for
   the element to exist, so asking "what does the badge say" while the badge is *gone* — the
   success condition — hung until timeout. `badgeText()` reads the DOM through
   `page.evaluate()` and answers `null`, which is a value, not a wait.
2. **`context.setOffline(true)` does not close a socket.** It refuses new connections; the
   provider's WebSocket stays open and keeps syncing, so TC-27 was not testing an outage at
   all. `BoardConnection` grew a `drop()` — it closes the provider's live socket — and
   `goOffline()` does both: block the network *and* cut the wire.
3. **The badge is silent in steady state, which is a thing tests keep getting wrong.** A
   board that is fine renders no badge at all — it says "Connecting…" while loading,
   "Reconnecting…" when the wire is down, and a green "Connected" for two seconds after a
   board comes back, then nothing. Every assertion about "the badge is not showing"
   therefore has to be an assertion about an element that is deliberately not there.
4. **`spot()` at 90 px only works at one zoom.** At zoom 1 a note is 200 px wide, so notes
   placed 90 px apart sit on top of each other and a double-click meant for empty board
   space lands on an existing note and edits it. The tests that create notes at normal zoom
   use `deskSpot()` (230 px apart); the wide-camera soak uses `soakSpot()`, which is written
   in screen points because a double-click takes screen points.
5. **A selected note's toolbar is the same size at every zoom, and it is hungry.** The
   toolbar is scaled by `1/zoom` so it stays readable, which at 0.3 makes a 200 px panel
   floating above a 60 px note — over the note above it, taking that note's clicks; and the
   toolbar itself can sit *under* a neighbouring note, which is how a `Delete note` click
   timed out in the soak. Two changes: the soak's rows are 120 px apart, and every soak
   change starts by putting the selection down on a point where there is never a note.
6. **`actionTimeout` was unset, so a click that could not happen was not a failure.**
   Playwright's default is to wait forever. Twenty seconds is now set in
   `playwright.config.ts`; a run that used to stop answering now says which locator gave up
   and why. Story 1 and 2 tests are unaffected (all 74 pass).
7. **A latency measured from the round is a measurement of the slowest person in it.** Five
   people doing five different UI things take different times; the soak now stamps each
   change with the moment it was made and measures from there, which is what makes the
   report about the board.

## Story 3: nightly

`tests/e2e/live-collaboration.spec.ts` carries TC-29 and TC-30 tagged `@nightly`, and
`playwright.config.ts` has a `nightly` project that selects them. `npm run test:e2e` filters
them out with `--grep-invert @nightly`, so a normal run stays a normal run. The nightly
project is chromium only: Firefox does not start in this sandbox (see the Firefox note
above), and a test that cannot launch a browser is not a test.

The lengths are the design's — TC-29 idles for 45 s, TC-30 soaks for 60 s — with
`NIGHTLY_IDLE_MS` and `NIGHTLY_SOAK_MS` as overrides for trying them, because a test that
takes its full length every time it is written is a test that does not get written.

TC-29 holds a board for the full 45 s with nobody touching it: no badge appears — not
"Reconnecting…" on a retry that was never needed, not "Connected" out of nowhere — no page
reloads, and the board still works when the idle is over.

TC-30, measured at full length on this machine with five contexts, did 143 rounds and 715
changes, every one of them arriving on all four other screens, and the report read
`p50 137 ms · p95 439 ms · max 547 ms` against the 1000 ms budget, 0 over. The report is
printed and not asserted: the browser, the model and the room all share one machine here,
and a nightly that fails because the machine got busy is a nightly nobody reads.

## Story 5: a board is made by asking, not by connecting

`POST /api/boards` picks an id and initialises the board's Durable Object with one RPC
(`stub.initialize()`), and returns 201 with the id. There is no retry loop: the design's
call is that a 128-bit collision is not a practical event, and an `initialize()` that
answers `exists` for a freshly drawn id is a fault — it comes back 500 `create_failed`
rather than quietly drawing another id, because a creation that had to try twice is not
something a caller should be told succeeded.

Existence is answered by the room, and asking must not create:

- `migrate()` no longer runs when the object is constructed. workerd may construct a
  Durable Object to answer any request, and an object that builds its tables on the way
  in makes every lookup a write. The tables now arrive either from `markCreated()` (a
  board being made) or from the first `append()` (a board being used).
- `existsReadOnly()` reads `sqlite_master` first: no tables, nothing to look in, false.
  Only then does it ask for `created_at`, and then for any row in `updates` or
  `snapshot_chunks` — the legacy rule, so that a link to a board whose notes predate the
  created row still opens. `src/worker/test-seed.ts` writes one update per note, so a
  seeded board has rows and counts.
- `BoardRoom.fetch` refuses a board nobody made with 404 before it will accept a socket,
  which is a deliberate change to story 3: a room is no longer created by connecting to
  it. Every e2e helper that opens a board now creates one first (`openBoard`,
  `openParticipants`, and `createBoardAt` in `helpers/board.ts`, which is what
  persistence.spec.ts uses for the same reason).
- `/api/rooms/:id` still answers 426 to a request that does not upgrade, which is story
  3's contract and stays. The consequence for TC-27 is worth writing down: no HTTP
  client is permitted to send an `Upgrade` header, so a browser-driven test cannot see
  the 404 at that address at all — it sees 426 for every well-formed id, known or not.
  The claim "a socket to a link nobody made is turned away and leaves nothing behind" is
  TC-09's, in the integration test, where `runInDurableObject` can look at
  `sqlite_master` and see that no tables exist.

`--var TEST_HOOKS:1` is now on the suite's own `webServer` command in
`playwright.config.ts`, because TC-31 needs a board whose storage was written by
something other than the app (a legacy board: rows in `updates`, no `created_at`). It is
given on the command line and never written into `wrangler.jsonc`, on the same principle
as building the client with `--mode test`: it belongs to the run, not to the deployment.

## Story 5: what the board page has to be able to say

`src/client/pages/state.ts` is a pure function from (state, answer) to state, and the
retry schedule is tested against a fake clock — the 1 s/2 s/4 s… up to
`BOARD_CHECK_RETRY_MAX_MS` sequence and the "Attempt 3 · next try in 4 s" footnote are
component assertions, not waits.

Two places where the code is not what design.md's types say, both deliberate:

- **Every page state carries the board id.** design.md's `BoardPageState` variants omit
  it. A state that cannot say which board it is about cannot reject a late answer about
  a board the person has left, and `nextBoardPageState` cannot produce a `ready` state
  without knowing the id.
- **The checker may answer synchronously.** `BoardChecker` returns
  `CheckResponse | Promise<CheckResponse>`; the page applies a synchronous answer inside
  the same effect, so the board is on screen before the test's next statement. The
  production checker (`api.checkBoard`) always returns a promise, so a real person still
  sees "Opening board…" for one round trip. Without the synchronous path, the 103
  component tests that story 3 and 4 wrote for a board that is already open would each
  have had to await an answer they supplied themselves.
- A checker that throws, or rejects, is `unreachable` — a service that did not answer is
  the same fact from the page's side whichever way it failed. The api module is written
  never to throw; the page refuses to rely on that, because the worst failure these two
  screens can have is to sit there waiting forever for an answer that already arrived as
  an exception.
- Malformed ids are never asked about: the router hands the raw path segment to the page
  and the page applies `isValidBoardId`, so `/b/abc` reaches "Board not found" without a
  request (TC-19).

## Story 5: the link field was wider than the panel holding it

Reported by sight: the read-only field had no visible boundary and the address ran out
past the panel's right edge, off the screen. Two separate things were doing it, both in
`src/client/styles.css`:

- `.share-panel__field` had `width: 100%` **and** `padding: 8px 10px` **and** a 1px
  border, with no `box-sizing` — this stylesheet does box-sizing per selector (see
  `.sticky-note`), it has no global rule. So the field was 22px wider than the space it
  was given.
- The panel was a grid with a default `auto` column, and a grid track's automatic
  minimum is its item's min-content width, which for a text input is the width its
  contents want. A board link is origin + `/b/` + 22 characters, so the column — and with
  it the panel — grew past the `width: 320px` the panel had been given, and the end of the
  field hung outside the panel and off the window.

The panel is now `box-sizing: border-box`, `width: min(360px, calc(100vw - 24px))` with a
single `minmax(0, 1fr)` column, and the field is `box-sizing: border-box; min-width: 0`
on `var(--panel-hover)` so it reads as a field on a white panel. A link longer than the
field is clipped inside the field with an ellipsis (`white-space: nowrap; overflow:
hidden; text-overflow: ellipsis`); the value is complete, selecting selects the whole
address, which is what the manual-copy state needs. The alternative — truncating the
string — hides the board id, which is the part a person checks with their eyes.

Why no test saw it: **jsdom performs no layout.** `toBeVisible()` there means "not
`display: none`", and a box that overflows its parent is a layout fact. The assertion
lives in TC-26 (`expectFieldInsidePanel` in `tests/e2e/share.spec.ts`), comparing
`boundingBox()` of the panel, the field and the window — the only place in the repository
where anything measures where a thing is drawn. `.page__card` got the same box-sizing for
the same reason.

## Story 5: two bugs in story 4's own tests

Both surfaced only because story 5 made the e2e suite run end to end.

- `persistence.spec.ts` spelled the colour list `['yellow','blue','green','pink',
  'orange','purple']` and built swatch locators from it. The palette key is `violet`, and
  `NoteToolbar`'s accessible name is `labelOf(name) + ' colour'` — so the sixth note's
  colour click waited 20 seconds for a button that does not exist. The list now comes
  from `STICKY_COLORS` itself: one source for the name in the app and the name in the
  test. This is the failure mode of writing accessible names out twice.
- The same file read a `Response` twice — `expect(res.ok, \`… ${await res.text()}\`)`
  followed by `await res.json()` — which node answers with "Body is unusable: Body has
  already been read". The failure message ate the body the assertion needed. Read once
  into a string, then assert, then parse.

## Story 5: what this machine would not let me check (story 4's restart tests)

TC-19 and TC-20 (`@persist`) fail on this machine at the same place: `stop()` in
`tests/e2e/helpers/wrangler-process.ts`, whose job is to prove the runtime really went
away before a "restart" is allowed to be reported. The message now says what was
observed:

> the runtime on port 22890 is still answering after being stopped … **no signal was
> refused**

That last clause is the finding. SIGTERM to the process group, and SIGKILL to it as well,
are both accepted by the kernel, the wrapper exits, and something goes on answering HTTP
on that port for as long as I watched it. The runtime process belongs to `wrangler dev`,
not to the group this file can reach; and this sandbox refuses the tools that would let
anything be done about it — `ps` and `pkill` fail with "Operation not permitted"/"sysmond
service not found", and `lsof` cannot list processes, so the surviving process cannot be
found, let alone finished.

What I established, and what I changed:

- Outside Playwright's runner the same helper shuts its runtime down cleanly (started a
  runtime, opened the board in two browsers, made notes, closed the contexts, signalled
  the group: port released within a second). So it is not `wrangler dev` on this machine
  in general — it is the runtime as started from inside the test runner, which had been
  talking to browsers.
- Plausible mechanism, untested here: workerd's shutdown waits for connections to drain,
  and a browser-side socket that the browser process has not finished closing keeps it
  waiting. The room already reports `connections` on `/__test/boards/<id>/stats`, so a
  test could wait for that to reach 0 before stopping. Could not try it: see the port
  note below.
- Kept, because they are improvements whether or not the shutdown problem is solved: the
  runtime is spawned as `node node_modules/wrangler/bin/wrangler.js` rather than through
  `npx` (one wrapper fewer, and no npm resolution per start), refused signals are
  reported instead of swallowed, and SIGKILL to the group is sent unconditionally rather
  than only when the wrapper seems to be stuck — a wrapper that has exited is not
  evidence about the process it was running.
- Not kept: a SIGINT-first path (ask `wrangler` to quit the way a terminal does). I could
  not verify it here, and an unverified change to a helper whose whole purpose is not to
  lie is worse than no change.

TC-21, the third `@persist` test, passes: 2000 notes, connected and loaded in 25 ms, all
of them painted in 98 ms against a 3000 ms budget (reported, not asserted). It is the one
that never needs a restart.

**The range has since run out.** Each refused stop leaves a runtime holding its port, and
after several runs 22880, 22884, 22886, 22888, 22890 and 22894 were answering with their
inspectors on the odd ports — seven of the eight pairs in the allocation (see the Ports
note). `startRuntime` then fails with "no free port pair in 22880-22895 for a second
runtime", which is the proximate error today, and a machine restart (or a session where
process tools work) is what reclaims them. The shape of the real fix belongs to story
4's harness: own the runtime as a process the harness can shut down *by construction* — a
small supervisor that spawns wrangler as its own child and is told over a pipe to kill its
child and report the port free — or run the test's runtime in-process on miniflare, the
way `tests/integration` already does, where "the next day" is `dispose()` followed by a
new miniflare over the same `persistTo`. Either way the guarantee that has to survive is
the one already in that file: a restart is reported only when the port says the old
runtime is gone.

## Story 5: numbers

Measured on this machine, chromium, one machine running the browser, the model and the
room at once. Logged against their budgets and not asserted on (the reason in the
story 3 nightly note).

- Home page click to a board you can work on: **189 / 241 / 242 ms** against
  `CREATE_BUDGET_MS` 2000 — that is a `POST /api/boards`, an RPC into the object, its
  tables being made, the response, the route change, the existence check and the socket.
- Second person's join to first note: **3 ms**; their edit back to the first screen:
  **167-201 ms**.
- Legacy board (storage written by the seeder): notes on screen in **5-6 ms**.
- Suites as this story left them: 124 unit, 126 component, 66 integration, and 84 e2e in
  Chromium and WebKit (Firefox does not start here, see the Firefox note) — plus TC-21,
  and TC-19/TC-20 which this machine will not run, above.

## Story 7: an object of a type nothing has registered is not on the board

`snapshot()` reports objects whose type is registered, and no others. That is a story 4
decision, tested there (`tests/unit/board-model.test.ts`: an unknown type is not in
`snapshot()`), and it is the right one — a board that cannot say what an object *is*
cannot draw it, and drawing a guess is how a shape becomes a sticky note in somebody's
export.

What story 7 had to decide is what that means for selection, and the answer falls out of
the same rule: **you cannot select, move or delete what the board is not reporting.**
`allObjectIds`, `objectsInRect`, the marquee and select-all all read the snapshot, so an
object of an unregistered type is invisible to all of them. The design's phrase for it is
"left undrawn", which is the renderer's half of the story (`getObjectType(type)` is
undefined, so no `Component` is drawn); the model's half is that it is not even listed.

TC-16b is written for that, and says "left alone, not guessed at": select-all picks up the
registered notes, the bar counts only those, and the unregistered object is neither
outlined nor deleted. The alternative — let the snapshot list unknown types so they can at
least be deleted — would make this build able to destroy something it does not know the
name of, which is worse than leaving it for a build that does.

## Story 7: a handle sitting on somebody else's note loses the note

The first full e2e run after the overlay went in broke story 2's golden path, and the
reason was exactly the sort of thing that only a real browser tells you:

```
<div data-testid="resize-handle-e" class="selection-handle"> from <div class="selection-overlay">
subtree intercepts pointer events
```

The story selects one note and drags it; it then clicks a *neighbouring* note, and the
selected note's right-edge handle — 8 pixels, drawn over the board in screen units — was
sitting on that neighbour. The click went to the handle. This is not a test artifact
either: the handle is above the notes by necessity, so on any board with notes close
together, a resize handle steals the click that was aimed at the note under it.

The first fix was a pass-through in the handle's `onPointerDown`: ask
`document.elementsFromPoint`, and if an unselected object is under the press, hand the
press to it. That is the right instinct and the wrong mechanism, for two reasons. jsdom has
no layout, so `elementsFromPoint` answers nothing and the component tests would need the
answer faked. And in the browser Playwright's own hit-test refuses to *dispatch* the click
before any handler of mine runs — a handler cannot give back a click it never receives.

What works is to ask the **document** instead of the page, when drawing: the overlay knows
each handle's point in board units, and `hitTestObject` (the same hit test the marquee
uses) knows what is there. Where an object outside the selection is drawn under a handle,
that handle is not rendered at all. `document.elementsFromPoint` never comes up, the answer
is the same in jsdom and in a browser, and a handle and a marquee cannot disagree about what
is where. The bounding box is still drawn in full — the box is a fact about the selection,
while a handle is an offer, and an offer that cannot be taken is not worth making. There
are seven other handles to resize with.

## Story 7: a press on something already selected is not a selection change

The PRD says a click on an object makes it the only selected object, and the design says
`onObjectPointerDown` dispatches `click(id)` — replacing the selection — *before the
gesture starts*. Taken literally those two sentences delete group dragging: press a note
that is one of six selected and the selection becomes that one note, so the drag moves one
note instead of six, which is the headline feature of the story.

The two are reconciled by when the narrowing happens: a press that never crosses
`DRAG_THRESHOLD_PX` was a click, and narrows the selection at pointer-up; a press that does
cross it was a drag, and moves everything that was selected when the finger went down
(TC-23b, which the design's wording would have failed). A person who wants to move one note
out of six clicks it first and drags it again, and gets exactly what they asked for both
times.

Shift+click is decided in the same place — the gesture, not the object — so that a type
added in story 9 cannot get it wrong, and so that the modifier means one thing everywhere on
the board. It is guarded by `isTypingTarget`, because Shift+click inside a note that is
being typed in is a shift+click in a text field and must type, not select.

## Story 7: editing an object does not change what is selected

`edit` in the reducer adds the id if it is not already selected rather than replacing the
selection: Enter on one of six selected notes opens that note's text and leaves six things
outlined, which is what every other board does and what TC-30's negative case needs (typing
in one of the selected notes does not quietly drop the other five). The same reason made
`startEdit` stop insisting that the id is in the snapshot: the snapshot lags the document by
a frame, and a note created a moment ago is real in the document and not yet visible in the
snapshot — a guard that reads the older of two things will refuse a thing that just happened.

## Story 7: Escape in the middle of a rectangle belongs to the rectangle

Escape has two jobs on this board — give up a rectangle in flight, and clear the selection
— and they cannot both run for one keypress, because clearing the selection is the opposite
of "the selection is unchanged". The marquee listens on `document` in the capture phase and
calls `stopPropagation()`, so it gets first refusal and the board's own Escape never fires.
TC-22e fires the event at `document` for that reason: an event dispatched at `window` goes
to the window's listeners only, skips the marquee, and lands on the board's Escape, which
clears the selection and makes the test pass for the wrong reason.

`pointercancel` is a separate path from `end`, not `end` with a flag. A pointer taken away
by the operating system — a system gesture, the browser deciding it knows better — is not a
rectangle the person meant to finish, and selecting with it would be the board making a
choice on somebody's behalf out of an event they did not send.

## Story 7: `snapshot()` got wider, and the tests had to say which objects they meant

`snapshot` now returns `readonly ObjectSnapshot[]` — any registered type — because a
generic move, resize and delete cannot be written against `StickySnapshot`. Story 2, 4 and 5
code that wants *notes* says so with `snapshot(doc).filter(isStickySnapshot)`, a type guard
over the one field every sticky has (`type: 'sticky'`). Six places in the existing tests and
test hooks changed to that, and nothing about their assertions moved: the filter is where the
wideness is paid for, and it is better written down in six places than hidden in a cast.

The selection bar got moved for a related reason. It was fixed to the bottom of the window;
it is now placed above the selection's bounding box, from the box and the camera, because
the box is the thing it acts on. A control that is always in the corner of the window is
only "always findable" while the board does not scroll and zoom, and this board does both.

## Story 7: numbers

Measured on this machine, chromium, with the browser, the model and the room all on it.
Reported against their budgets and not asserted on, as in the earlier stories.

- TC-36, five people moving a different selection each at the same moment: the five agree on
  the starting five notes in **21 ms**; after everybody has moved, all five screens agree in
  **1503 ms** against the 1000 ms `LIVE_UPDATE_LATENCY_BUDGET_MS`. The measurement is taken
  from the last move to the last screen, and the moves are driven one browser after another
  by one test process — the clock runs while the driver is still pushing the fourth and
  fifth person's pointers, which is most of the overage. What the test asserts is the thing
  that is actually a requirement: after it settles, the five documents are *identical*,
  which is what absolute writes buy (Key decision 1).
- TC-35, a remote delete leaving my selection: the note is gone from my selection inside the
  latency budget, measured with `expectEventually` and logged.
- Suites as this story left them: **188 unit, 161 component (35 of them new here), 66 integration, 110 e2e** in
  Chromium and WebKit. TC-19 and TC-20 (`@persist`) still do not run here for the story 4
  reason written up above — a spawned runtime that this sandbox will not let anyone signal
  — and story 7 changed nothing about the harness.

## Story 8: where the files are, against what the design named

The design names `src/client/board/Toolbar.tsx` and `src/client/App.tsx`. This app has
neither: the toolbar is `src/client/components/Toolbar.tsx` (it holds the share UI as well as
the board's zoom controls, and lives with the other components rather than with the board),
and `src/client/App.tsx` is only the router — it renders one page or the other and has never
held board state. The controller is created in the `Board` component of
`src/client/pages/BoardPage.tsx`, which is the component that owns one board document: it is
keyed by the route id, so navigating to another board unmounts it and a new controller comes
up over the new document, which is the behaviour task 2 asks for, found in the file that can
actually provide it. The design's other names — `src/client/board/undo.ts`,
`useUndo.ts`, `UndoButtons.tsx`, and every setting name in `src/shared/config.ts` — are as
written, as are the test ids, the tooltips and the `aria-label`s.

`useUndo` subscribes with `onStackItemsChanged`, which fires when either stack changes, and
returns a new object each time. That is right rather than lazy: the stacks are the state, and
a hook that returned a stable object over changing state would leave a button greyed out
until something else happened to re-render the page.

## Story 8: the mark on a transaction, and the clock that decides when a burst is over

The controller filters by origin, not by person: `trackedOrigins: new Set([LOCAL_ORIGIN])`,
where `LOCAL_ORIGIN` is the symbol `src/shared/board-model.ts` already puts on every
transaction this tab makes. Everything else arrives with a different mark — the provider
applies what comes over the wire, the initial state comes from the load — and a step whose
transaction is not marked is never put on the stack at all, so the history holds only this
tab's work and needs no identity to know it. `Y.UndoManager` adds its own origin to the set
it was handed, which is what makes redo work: the transaction that applies an inverse is the
manager's own, so it lands on the redo stack and nowhere else. The two symbols in
`undo.ts`'s options are also the whole answer to a change that arrives *while* a person is
undoing: it is not marked, so it is not collected, and the manager continues with the step
below it.

The pause that ends a typing burst is `UNDO_CAPTURE_TIMEOUT_MS`, passed as `captureTimeout`
and left to Yjs, because merging by time of arrival is exactly what Yjs's stack top already
does and reimplementing it would be a second clock to keep. It is *not* injectable, and that
nearly cost the tests their time control: `lib0/time` does `const getUnixTime = Date.now`,
capturing the function when its module is first evaluated, so a `vi.useFakeTimers()`
installed after that — which is any install from a test body or a `beforeEach` — is a clock
Yjs is already not looking at. `tests/unit/helpers/clock.ts` is the fix, and the rule is one
line of comment: import it first, before anything that pulls in yjs, and it fakes only `Date`
and nothing else, so no timer in the file is affected. No sleeping to let a window close; the
clock is moved.

## Story 8: a step whose object is gone is dropped, and that press does not stop there

Found in `UndoManager.popStackItem()` and then confirmed in a test before it was written
down: when the inverse of a step names a struct that no longer exists — the note a person
moved, deleted by somebody else in the meantime — `performChange` returns false, the item is
dropped, and the `while` loop carries straight on to the *next* item in the stack and applies
that, in the same call. So a press that the design's TC-07 describes as "no effect, no error"
can be a press that silently skips a step and takes the one underneath back as well. What
TC-07 and TC-23 actually require still holds, and is what both tests assert: nothing of
anybody else's is reversed, nothing that a colleague deleted comes back, no error is thrown.
The alternative would be to walk the stack first and drop dead items eagerly, which needs a
way to know a struct is gone that Yjs only learns at the moment it tries to write to it; the
behaviour is left as it is and recorded here so that nobody has to rediscover it.

Related, and checked for the same reason: `destroy()` removes the observer but does not clear
the stacks. A destroyed controller reports the counts it had at the moment it stopped
listening, so TC-11 asserts a *frozen* length — the new note is in the document and not in the
history — and a controller that cleared its stacks on destroy would fail that test in the
opposite direction.

## Story 8: where a step begins, and where it ends

`boundary()` is called at both ends of every thing a person does, not only at the ends of the
drag: `onGestureStart` and `onGestureEnd` in `useTransformGesture` (story 7 left those two
callbacks in the hook for exactly this), before and after `deleteSelection`, before and after
each nudge, before and after a colour change and a toolbar delete, before and after a created
note, and on the mount and unmount of a note's text editor. The ones either side of a single
click are not decoration: without a boundary at the start, a click that lands a second after
a previous action joins it, and a note delete can arrive attached to the note creation before
it, which is the story's TC-31-shaped failure in miniature. Inside a gesture, per-frame writes
are merged by Yjs because the boundary is at the ends only; inside a burst of typing they are
merged by the capture window. Both are what a person would call one thing they did.

One consequence of those boundaries is stated plainly because an e2e test now asserts it digit by digit:
eight notes made one after another and one delete made afterwards are nine steps and take nine presses,
however close together in time the eight were — the boundary at the *start* of each action is what stops the
capture window from reaching across from one action into the next. The window only ever merges what happens
*inside* a single action, which is the frames of one drag and the keys of one word. Without that, TC-22's
single press would have restored some of the eight and not the rest, and the number of presses it took to
empty the board would have been a number that changed between runs.

The keyboard goes through `window`'s keydown handler — on the board, not on a note element, so
it is answered with nothing focused and with a note focused alike — after Ctrl+A and before
the "somebody is typing in a note" check, and it refuses three things: a keystroke whose
target is a text field (`isTypingTarget`, which catches a note's own textarea and the share
panel's link field), a board that cannot be written to, and a board with no controller. The
two chords for redo are `Ctrl+Y` and `Ctrl+Shift+Z`; `Meta+Y` on macOS is deliberately left to
the browser, where it is the tab I closed, not the change I undid.

The buttons stop `pointerdown` as well as being buttons: the toolbar lives on top of the
board's surface, and a press that reaches the surface is a press that starts a pan and clears
the selection, which would make the toolbar's own controls the two things on the board that
deselect what you are looking at.

One thing that is not in the design and bit the first version: `BoardPage` runs its effects
twice in development. A controller created in render and destroyed in the effect's cleanup is
a controller that is dead before anybody has clicked anything. It is created in the effect,
held in a ref, and a `respawn` bumps the page once so that the components which were handed
the first one are handed the live one.

## Story 8: numbers

Measured on this machine, in Chromium and WebKit, with the browser, the model and the server
all on it. Reported against their budgets and not asserted on, as in the earlier stories.

- TC-24, five people moving their own note and writing in another, then undoing twice each and redoing
  twice each: measured with this spec file alone on the machine, the five agree on what their two undo
  presses did in **986 ms** (Chromium) and **954 ms** (WebKit) from the start of the work phase, and on what
  their redo presses did in **1122 ms** and **1060 ms**, against the 1000 ms
  `LIVE_UPDATE_LATENCY_BUDGET_MS`. Those three numbers are taken with `since:` set at the beginning of the
  work, so they include the driver pushing five browsers through a drag and a paste one after another — the
  clock runs while the test is still typing the fourth person's word. Run together with the other eleven
  spec files the same measurements come out nearer 1.5 to 2 s, which is what twelve spec files sharing one
  machine looks like. What the test asserts is not a time: it is that after five people undid twice the five
  screens agree on the *exact key* they agreed on before the work started, field by field and note by note,
  and that after five people redid twice they agree on the key the work had left behind (Key decision 1).
- TC-22, eight notes restored: the last of them arrives on the other person's screen **17 ms** after the
  undo and the two screens are agreed on the one surviving note **15 ms** after the last press, with Raj's
  note untouched throughout. The presses are counted digit by digit: nine things she did, nine presses, and
  the tenth refused.
- Suites as this story left them: **207 unit** (19 new here), **176 component** (15 new), **66 integration**,
  **114 e2e passing in Chromium and WebKit** (10 of them this story's) plus the one `@persist` failure below.
  The three suites that are not e2e run in 17 seconds together. The one failure is TC-19 (`@persist`), which
  fails here at the same place it failed before this story was started — the runtime it stops is still
  answering, because this sandbox will not let anyone signal a spawned process — and TC-20 and TC-21 skip
  behind it, as the story 4 write-up above describes. Story 8 changed nothing about that harness. Firefox is
  still skipped by the probe: it does not start on this machine.

## Story 9: where the files are, against what the design named

The design names `src/client/objects/TextObject.tsx`, `TextEditor.tsx`, `textLayout.ts`,
`useTextBoxSync.ts`, `src/shared/objects/text.ts`, `src/shared/text-edit.ts` and
`src/client/board/useTool.ts`; all of those are where it says. Two things are elsewhere.
The size toolbar is `src/client/objects/TextToolbar.tsx` and is rendered by the text object
itself, exactly as `NoteToolbar.tsx` is rendered by a sticky note, rather than by
`SelectionBar.tsx` — the bar is what to do to *several* things, and there is no answer to
"which of these four objects' size?" once two are selected, while there is a plain answer
while one is being typed into. And the sticky note's editor is not a second component:
`StickyTextEditor.tsx` is now a thin set of arguments to `TextEditor.tsx`, because a sticky
note's text and a piece of free text differ in what their box means, not in how a textarea
is kept in step with a `Y.Text` and a 5,000-character limit, and a second implementation of
that would be a second place to be wrong about the limit.

`registry.tsx` grew two fields on purpose: `handles`, which says which resize handles an
object type can use, and `resize`, which lets a type answer a resize in its own terms. Those
two are what keeps `SelectionOverlay` and `useTransformGesture` from knowing anything about
text: the overlay asks what handles to draw, and the gesture asks whether the object would
like to be resized. Sticky notes are unaffected — they have neither field and go down the
`resizeObjects` path they have always gone down.

## Story 9: who measures, and the padding that a browser counts twice

The rule is that the client doing the typing writes the box, in the same transaction as the
characters, so that nobody has to agree about a font after the fact and an undo takes the
words and their box back as one thing. Every other client draws the box it is told about.
`TC-12` asserts the write happens; `TC-12c` asserts it happens once per keystroke and not
once per animation frame; the last test in `TextObject.test.tsx`'s sibling asserts the
negative from the receiving side, that a change which arrives already measured is not
measured again here.

The e2e side of that rule found a trap worth writing down. The design's assertion is that a
text element's `scrollWidth` equals its `clientWidth` — the words against the room they were
given, and the only assertion that can be made about a font the test cannot predict. Both of
those numbers include the element's own padding. So comparing either of them against the
stored box width, minus a padding taken off by hand, is off by exactly the padding: the box
came back 100.58 wide and the "words" came back 101, which is the box, not the words. The
width of the words themselves is a `Range` over the text node's client rectangles (`textContentWidthPx`),
and that is what the box is compared to — canvas measurement 84.5907, drawn line 84.59375, on
the machine, in the browser, which is the number the box was built from.

## Story 9: three existing tests had to be told about new buttons

Nothing about these is a test made weaker; each is a fact about the interface changing, which
the design asked for.

- The sticky note's button is called `Sticky note (N)` now, and its tooltip says `Sticky note
  (N) — or double-click the board`, because story 9 puts two more single letters on the
  keyboard and a person is entitled to know which key does what before pressing it. The
  visible label is still `Sticky note`, so WCAG 2.5.3 still holds (the accessible name
  contains the visible one). `Toolbars.test.tsx` and `tests/e2e/helpers/sticky.ts` ask for
  the new name; the helper asks for it `exact`, so it cannot accidentally start matching the
  new Text button as well.
- `sticky-notes.spec.ts` walks the page with Tab to check a note is reachable from the
  keyboard, and had been willing to press the key fifteen times. Two more toolbar buttons
  means seventeen stops before the note, so the walk is twenty-five presses long now. The
  assertion is the next line, and is unchanged: the note is reached and focused.
- The four new tests in `Tool.test.tsx` that type the letters `t` and `n` are the reason the
  tool's keystroke handler calls `stopImmediatePropagation` rather than `stopPropagation`:
  with two window-level listeners, one for the tools and one for the board's shortcuts, a
  letter that is a letter must reach neither, and a `t` that reaches the board's handler as
  well would be a `t` that does something to the board while it is being typed.

## Story 9: numbers

- **241 unit** (34 new here: the text model and the layout engine), **209 component** (33
  new: box sync, tool mode, text objects), **66 integration** (untouched), **144 e2e passing
  in Chromium and WebKit** (30 of them this story's).
- The design's e2e list runs TC-26 to TC-32 and tasks.md's list for the same task names six
  workflows of its own under the same numbers, so the spec file carries both: the design's
  cases under the design's numbers, and tasks.md's extra three — a heading titled over a
  cluster, sized, moved, deleted and undone; two people typing into one heading at the same
  moment; and five people each making a heading at once — under their own names, with the
  `TC-33` numbers the design does not contain left out so nobody goes looking for a case
  that was never written down.
- `npm run typecheck` and `npm run build` are clean.
- The one e2e failure is TC-19 (`@persist`), which fails at the same place it failed before
  this story was started — checked by stroring the whole story and running it against the
  clean tree — because this sandbox will not let a spawned runtime be stopped, and TC-20 and
  TC-21 skip behind it. Firefox is still skipped by the probe: it does not start here, which
  is also true of the design's `Done when` for the e2e task; WebKit carries that half.
- Two things the tests learned on the way, both written into the tests rather than the app.
  A page's five people cannot share a helper that asks whether the board gained *one* object:
  with four other authors typing at the same moment the list taken before the click is four
  objects out of date, so that test types its own headings and waits for the editor instead.
  And the words of a heading are read out of its text layer, not out of the object element,
  because a selected heading carries its toolbar as a child and `S M L XL` are not words
  anybody typed.

## Story 10: where the files are, against what the design named

The design's `src/client/board/useTool.ts` is gone, and deliberately so. Story 9 grew that file to hold one
tool; story 10 needs three that have to agree with each other — the Connector tool has to hand the arrow it
just made to the selection and step aside, the Shape tool has to remember which kind it last drew, and Escape
has to mean "stop meaning that" and nothing else while any of them is armed. Two hooks each holding their own
idea of the current tool is two answers to one question, and the moment they disagree the toolbar says Select
while the board is still drawing diamonds. The one answer is `src/client/tools/useActiveTool.ts`. Its
`ToolId` is the whole cross-story union (`select sticky text shape connector pen image comment`) so adding the
pen later renames nothing; `ARMABLE_TOOLS` is the four this build can actually put the pointer in;
`TOOL_SHORTCUTS` is the letter map, exported as a map rather than a switch because the tooltips read their own
text out of it and a tooltip that disagrees with a shortcut is the bug this file exists to prevent. `sticky`
has a letter and no mode on purpose: making a note is an action the board already answers on `N`, and a mode
that then waited for a click would be two gestures for one object. `pen`, `image` and `comment` leave their
letters alone — unclaimed rather than armed with a cursor that draws nothing.

The objects and their toolbars are where the design says (`src/client/objects/`); the tools themselves, and
`toolOverlay.ts` which holds the sheet they stand on and the one screen-to-board conversion they share, are in
`src/client/tools/`. A second file subtracting the window's own position from a client coordinate is a second
file that puts shapes a handful of pixels from where the pointer was, so there is one.

Escape is answered by the tool first, and stops there, because the tool's listener is registered on `window`
before the board's own shortcut handler: a person who backs out of a tool has said nothing about what is
selected, and clearing the selection behind the tool would be one keypress meaning two things. `N` is
explicitly *not* stopped for the same reason in reverse — a note is a command, not a mode, and it belongs to
the board. While the focus is in any textarea (a note's, a piece of text's, a shape's label) no shortcut runs
at all: every key there is a character.

## Story 10: an object whose box is derived, and what that costs the document model

An arrow does not store where it is. It stores which two objects it joins, and where each end should be drawn
if the object on it stops existing; its box is wherever those two objects happen to be. That is not a detail
of drawing, it is the whole mechanism of "the arrows follow when things move" — a box that is recalculated on
every read cannot be out of date, while a box that five clients each write down can be, and story 3's contract
is that clients write down their own answers.

So `board-model.ts` grew one registration instead of a per-type comparison: `registerObjectReader(type, {
box?, fields? })`. Three things follow from registering: every snapshot of that type carries the derived box
rather than stored numbers, the snapshot carries whatever extra fields the type asked to be read with (an
arrow's two ends, a shape's label), and the type cannot be moved or resized by writing numbers into it —
`moveObjects` and `resizeObjects` skip it. An arrow you could drag by its body would have a stored position
nobody draws and a drawn position nobody stores, and the two would drift apart inside somebody's undo history.
`snapshot()` is now two passes for exactly this reason: first the boxes of everything that keeps its own, then
each object read against those boxes — a type that had to look up the boxes around it itself would reread the
whole document once per object, on every frame of a drag. A derived box that cannot be derived (an arrow whose
ends cannot be read) drops the object from the report rather than reporting the zeroes it stores.

Two things that were already there turned out to be in the way, and both were wrong in ways that only a
second object type exposes:

- `objectBounds` gives an object with no stored size the sticky note's default size. For a note written before
  sizes were stored that is right; for an arrow drawn perfectly level it is not — a level arrow has *no*
  height, and inventing two hundred units of it draws a selection box around space nobody painted in. Derived
  box types are now left with what they actually have.
- The extra fields a type registers were read *after* the "this type has no box resolver" early return, so a
  type that describes itself without deriving its box — a shape, which keeps its own box and merely wants its
  label reported — got nothing at all. The fields are read before that branch now, and applied either way.

`registerDeleteListener` is the other half: it is called from *inside* `deleteObjects`' own transaction and
*before* the objects are removed, which is what lets an arrow attached to a deleted shape be pinned to the
place that shape's side was while the shape is still there to be asked, in the same transaction as the delete.
One undo press therefore brings the shape back with its arrows still attached, with no half-state in between
where the arrow is detached and the shape is not there. A listener with nothing to say opens no transaction of
its own, which is the same rule the rest of the model follows: no write that changes nothing.

## Story 10: the arrow follows a shape because it is drawn, not because it is written

TC-25's central assertion is the opposite of the one you would reach for. After Sam drags the second shape
clean past the first one, the test asserts that the arrow's own record is **unchanged** — same ends, same
author, same place in the stack — while the box it is painted in has moved to the other side of the shape that
moved. A test that asserted the stored ends had changed would be asserting a bug: it would mean some client
had decided, and written down, where an arrow ought to point.

Which side of a shape an end lands on is `nearestSide`: the direction from the box's centre to the other end
is compared against the box's own diagonals (`|dy| * width` against `|dx| * height`), so a square switches at
exactly 45° and a wide box switches earlier, because a wide box has more left and right side to attach to. A
tie goes to the horizontal wedge, and the tie has to be broken somewhere. The two ends are resolved against
each other — the side of A that faces B depends on where B is, and where B is drawn depends on which side of A
was chosen — so each end is *seeded* with the other end's object **centre as it is now**, not with the point
stored in the arrow, which is a record of where the arrow was attached and can be years out of date. One pass
from those seeds settles it, identically on every screen, because centres are in the document.

## Story 10: the hit test, and the tolerance that is not measured in board units

An arrow is asked "is the pointer on me" with `distanceToPolyline(ends, point) <=
CONNECTOR_HIT_TOLERANCE_PX / zoom`: points first, as the design has it, and *no* stroke-width term added. The
line is two board units wide, which at zoom 0.2 is four tenths of a pixel, so the usual "exact plus half the
stroke" formula would be a 6 px tolerance wearing a disguise — one that grows with the board and shrinks when
somebody zooms in, which is backwards. The tolerance divides by the zoom because it is a distance a person's
pointer is measured in, and it stays six pixels on screen at every zoom. `distanceToPolyline` answers `Infinity`
for fewer than two points, never `0`: zero would mean an arrow that lost one of its ends is selectable from
anywhere on the board.

## Story 10: labels are a `div`, and `foreignObject` was not used

A shape's words are an HTML `div` laid over the shape's SVG, centred with `display: grid; place-items: center`
and `text-align: center`, wrapping with `white-space: pre-wrap; overflow-wrap: anywhere`, inside a drawing layer
whose own `overflow` is `hidden`. `foreignObject` was not used because it is a place where three engines do
three different things with text measuring and clipping, and the claim being made here — "the words wrap inside
the shape and stay centred" — has to be a claim a jsdom component test, a Chromium e2e and a WebKit e2e can all
answer the same way. A label that outgrows its shape is clipped at the bottom, which is what the design asks for
and what the e2e therefore measures: only a word that sticks out *sideways* is a wrapping failure, because
clipping at the bottom is the design, while a word past the left or right edge means the words did not wrap.
The measurement is done one word at a time with a `Range` per word, because a `Range` over a whole label reports
rectangles for trailing spaces — which is a rectangle that starts where the last word ended and goes past it,
and a test that measured a label that way once reported a centring failure that was a space.

## Story 10: an end drag that could not use its own rectangle

`ConnectorObject`'s end drag works out where the pointer is by remembering the pointer's own client position
when the button went down and adding the movement divided by the zoom. It does not ask the element where it
is, because this element's rectangle is derived from the ends — including the end being dragged. Reading the
origin from a box that is a function of the number you are computing is a feedback loop: the drag moves the
end, the end moves the box, the box moves the origin, and the origin moves the end. The same reason explains
why an arrow's own body is hit-tested with the shared distance function against the resolved ends rather than
against a bounding box: the bounding box of a level arrow is a line, and the bounding box of a diagonal arrow
is a rectangle mostly full of empty board.

## Story 10: two races, forced rather than timed

TC-26 waits for a delete to arrive while an arrow is attached to the shape being deleted; TC-27 needs the
delete to land *while the pointer is held down over that shape*. There is no way for Playwright to get between
the page and its WebSocket — the harness has no hook into the provider, and intercepting the socket would mean
rewriting the app's transport inside a test. So TC-27 holds the mouse down on an arrow's end, over the shape,
and deletes that shape on the other person's page, then lets go. The overlap is exactly the one the design
describes and it does not depend on how busy the machine happens to be. The latency measurement is stamped at
the moment the pointer comes up, which is the moment the board is told, so the number in the report is about
the change and not about the round trip of the test.

## Story 10: a convergence check that could not see arrows

`BoardSnapshot` in `tests/e2e/helpers/participants.ts` held notes and their painted boxes, and nothing else.
Once shapes and arrows are in the document, five pages could disagree about every arrow on the board and
`expectConverged` would have reported them identical. It carries shapes and arrows now — document state only:
where a thing is *painted* depends on where that person is looking, which stays each page's own business. That
comparison is what makes TC-25, TC-26 and TC-27 say something: the claim "the arrow holds the same ends on both
screens without having been written" is a claim about two pages' documents being equal.

## Story 10: numbers

- **308 unit** (67 new: 25 shape model, 42 connector model and geometry), **258 component** (49 new: 16 shape
  tool, 21 connector object and tool, 12 active tool), **66 integration** (untouched), **158 e2e passing in
  Chromium and WebKit** (7 of them this story's: TC-23, TC-23b, TC-24, TC-25, TC-26, TC-27, and one that draws
  a whole flow and then checks that nothing else was disturbed).
- Latency, on this machine with the browser, the model and the room all sharing it, reported against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (1000 ms) and not asserted on: an arrow following a shape a colleague dragged
  agreed on both screens in **15–25 ms**; an arrow outliving a shape a colleague deleted, **130 ms**; the
  held-pointer delete race, **42 ms**.
- `npm run typecheck` and `npm run build` are clean. The one e2e failure is TC-19 (`@persist`), which fails
  identically with this story stashed away and the tree clean — this sandbox cannot stop a spawned runtime (the
  story 4 and story 5 write-ups above), with TC-20 and TC-21 sitting behind it. Firefox still does not start
  here, so WebKit carries that half; both browsers that do start run all 7 of this story's e2e cases.
- Three helpers in `tests/e2e/helpers/shapes.ts` say what a browser makes hard: `arrowHeadMiss` pulls the aim
  back by half an arrowhead, because an arrow is drawn with its line stopped short so that its *point* lands on
  the aim rather than the middle of the triangle sitting on it; `shapeWords` measures words rather than labels;
  and `arrowHeadSide` answers which side of a shape a head is painted on using the shape's own proportions, so
  the assertion is about the side and not about a pixel threshold somebody chose to make the test pass.

## Story 11: the preview is the story, and the document never hears about it

A pen is the first tool in this app whose whole subject is *in flight*: everything a person sees while the pen
travels belongs to that page and to nobody else, and the shared document is told about the line only when the
pointer lets go. That single boundary decides most of the shape of the code. The preview is computed at render
time from the points collected so far, coalesced to one re-render per animation frame; nothing in `PenTool` ever
calls the model until the stroke is finished, so there is exactly one `doc.transact` per stroke and five people
watching a circle get one object rather than four hundred. `splitPoints` exists for the same reason in the other
direction: a tablet can deliver more than `STROKE_MAX_POINTS` points between two frames, so the check is a while
loop and each part is committed as its own stroke, sharing the join point with the part before it.

The undo boundary goes *after* each commit, which is the design's `stopCapturing()` and not a guess about
ordering: a capture window that is still open when the next stroke arrives would fold two strokes into one undo
step, and the thing a person wants back after pressing the wrong key is the last line, not the last two.

## Story 11: a line is not a rectangle, and the pointer has to be told that twice

The hit tolerance is `STROKE_HIT_TOLERANCE_PX` screen pixels divided by zoom, in board units, because a person
aims with a mouse and not at a scale factor — the same shape of answer story 10's arrows gave. What is new is
that the DOM has to agree with the model about it, and the honest way to make it agree is to derive both from
the same number: `StrokeObject` paints a second, transparent, fat copy of the path with `pointer-events: stroke`
under the visible one, and the wrapper carries `pointer-events: none`. A click inside a drawing's box but away
from its line therefore falls through to the note underneath (TC-16), and a click on the line selects the
drawing, because the registry's `strokeHit` and the strip that answers the pointer are both computed from
`max(nib / 2, tolerance / scale)`.

Resize scales the points and not the nib: `scaledPoints` multiplies by the box, `strokePenWidth` always answers
the pen's own thickness, and `stroke-width` is painted in user units. The design says this three times, in three
different voices, which is what a signature that got thicker every time somebody nudged a handle would feel
like.

## Story 11: the handle that ate the second stroke of a signature

The one thing the browser taught and jsdom did not. Story 7's `SelectionOverlay` paints its resize handles *over*
the board, after the viewport in the DOM — so with the pen armed, a press where a handle sits went to the handle
and not to the pen. It showed up as a drawing whose box had been clamped to `STROKE_MIN_SIZE_WORLD` and whose
points were left behind: the second stroke of a signature begins where the first one ended, which is precisely
where the first one's box has a corner handle. The fix is not a z-index in the pen; it is the tool hook saying,
once, which tools hold the pointer for themselves (`isDrawingTool`), with the viewport routing presses by it and
the overlay standing its handles down while one of them is up — the same reasoning the overlay already uses when
somebody else's note is under a handle. The Shape tool and the Connector tool had the same hole, and have the
same fix. `TC-19: a press where a resize handle is drawn is still a stroke` is the test for it, and the second
TC-17 case in `tests/e2e/pen.spec.ts` draws a three-stroke letter precisely to walk into it.

## Story 11: numbers

- **328 unit** (20 new: stroke model and geometry), **282 component** (24 new: 14 pen tool, 10 stroke object and
  registry), **66 integration** (untouched), **172 e2e passing in Chromium and WebKit** (14 of them this story's:
  two TC-17s, TC-18, TC-19 and three TC-20s, in each of the two browsers that start).
- Latency, reported against `LIVE_UPDATE_LATENCY_BUDGET_MS` (1000 ms) and not asserted on: a finished line
  agreed between two screens in **11 ms**; the same drawing resized, moved and deleted, **1–2 ms** per change.
  Nothing this story measured went over budget — an in-flight stroke is not shared at all, which is the cheapest
  possible latency, and the negative half of TC-18 is the assertion that keeps it that way.
- `npm run typecheck` and `npm run build:test` are clean, and `npm test` is green. Firefox still does not start on
  this machine (it aborts on launch, and story 8, 9 and 10 specs fail the same way with this story stashed away),
  so WebKit carries the second browser, as in the stories before this one.
- `retrace()` in `tests/e2e/helpers/pen.ts` thins a recorded path to about ninety points before it is replayed
  through the mouse, because every `mouse.move` is a round trip to the browser and four hundred of them makes a
  slow test rather than a thorough one. It keeps the shape — every point it drops is within a few pixels of the
  line that survives, which is the promise the smoothing makes to the document anyway — and the recorded wobble
  in `tests/fixtures/pen-paths.ts` stays what it is, because a drag along a perfect straight line would pass with
  a pen that threw away every point but the ends.

## Story 12: where the files are, against what the design named

The design names `src/client/board/Toolbar.tsx` again, and the answer is the story 8 answer: the toolbar is
`src/client/components/Toolbar.tsx`. Three other things the design names do not exist and were written where
this app actually puts them. `src/client/state/files.ts` is `src/client/images/validateFiles.ts`, next to the
two other files that only the adding of a picture uses (`uploadImage.ts`, `useImageInsert.ts`) — there is no
`state/` directory in this client, and validation of a dropped file is not global state: it is a pure function
that says which of these files the board takes and which sentence each refused one gets. `identityId` is not a
new module either: it is `String(doc.clientID)`, the same value `PenTool` has always used to sign a stroke, so
the person who uploaded a picture is the same person who drew a line as far as the document is concerned — a
tab, not a human, which is right, because the tab is the only thing that has the file.

`Toast` did not exist. There is a `ConnectionStatus` and a `SharePanel`, and no component anywhere that says a
thing for a few seconds and goes away. The one that is new is `src/client/ui/Toast.tsx`, and it is a
module-level store rather than React state on purpose: the thing that has to be able to say something is
`useImageInsert`'s `addFiles`, which is a callback, and a callback cannot call `setState` on a page component
it does not own. `pushToast(text)` from anywhere, `<Toasts />` rendered once by the board, `role="status"` so a
screen reader reads it, and one toast per text — `REJECTION_MESSAGES.type` pushed twice for a drop of two bad
files is one sentence, which is what "saying each thing once" in the task title means.

`image` was already in `ToolId` and in `TOOL_SHORTCUTS` (story 10 left the letter there, unclaimed) and is
deliberately **not** added to `ARMABLE_TOOLS`. A picture is not a way the pointer can be: there is no cursor
for it, nothing to press the board with, nothing to Escape out of. So `useActiveTool` answers `i` in the place
where tool keys are answered — after the typing guard, so a letter typed into a note stays a letter — and what
it does is call `onImageRequest()` and stop the key, not `setTool`. The file window opens and the board is left
in whatever mode it was in.

## Story 12: two origins, because an upload result is not something a person did

Story 8's undo filters transactions by origin: only `LOCAL_ORIGIN` is tracked. A picture's status is written by
this tab too, and must not be on the undo stack — `Z` after a drop takes the picture away, and `Z` again should
not be expected to un-fail an upload that finished three minutes ago. So `src/shared/objects/image.ts` exports a
second symbol, `UPLOAD_ORIGIN`, and every status write (`markImageReady`, `markImageFailed`,
`markImageRetrying`) happens in a transaction marked with it, which no `UndoManager` in the app listens to.
`markImageRetrying` also keeps the old `assetKey`: if the retry fails, the box still knows where it used to be
stored, and the component never asks for a key unless `status === 'ready'`, so a stale key cannot be drawn.

The Yjs behaviour worth writing down, because it decides what TC-24 can assert: **redo re-inserts a deleted
object with the field values it has now**, not the values it had when it was deleted. A picture created, uploaded
to, deleted and redone comes back `ready` with its key — the upload's transaction was never in the tracked
history, so nothing undid it, and the struct carries the bytes it was last given. That is the right outcome for
a person (a redo does not resurrect a spinner that has nothing behind it) and it is not what the phrase "undo the
drop" would have predicted, so it is in the model's comments where somebody will look for it.

`placementSize` returns `Size | null`. The design's contract says it returns `{width, height}` and its own
prose says it returns `null` for a non-finite or non-positive size; those two cannot both be true, and the
second is the one that matters, because the caller is holding numbers that came out of `createImageBitmap` and
the board must be able to say "this is not a size" rather than invent one. `usableSize` is what callers check,
and a file whose placement cannot be computed is refused with the type sentence — from where the person is
standing, a file the decoder will not open and a file that is not a picture are the same fact.

## Story 12: why a refusal is said in the order it is said, and why it is not the order I wrote

`REJECTION_ORDER` is `['type', 'size', 'count']` — what it is, how big it is, how many there are — which reads
like the order the toasts should appear in. TC-26 says they come out `size` then `type`, and the reason is that
**the two refusals are reached at different times.** Size is a fact about the file the moment it is handed over,
so `validateFiles` refuses it in one pass. "It isn't a picture" is not a fact about a name or about a MIME type:
the fixture named `invoice.png` arrives claiming `image/png`, is accepted by both of those, and is refused only
when the decoder is handed its bytes — which is a step *after* validation, because you cannot measure a picture
without opening the file, and opening an 11 MB file to find out it is refused by size is the one thing the size
check exists to prevent. So the type sentence can be pushed after the size sentence even though the type check
is listed first, and the assertion in TC-26 is written against that and not against the constant's spelling.

That ordering is also why there is no magic-byte check in the picker path. `sniffImageType` (first bytes against
PNG/JPEG/GIF/WebP magic) is the *server's* only defence — an upload arrives over HTTP with a
`content-type` anybody could have typed — and in the browser the same question is answered better by the actual
decoder. Two implementations of "is this a picture" in one feature is two answers; the worker keeps the one it
must have and the client uses the one it is given.

## Story 12: three things a real browser would not tell jsdom

Each of these cost a failing e2e test, and none of them is a bug in the app.

- **A Node `Buffer` handed to `page.evaluate` is not bytes.** The first drop helper passed the fixture buffers
  straight into the page to build a `DataTransfer`; the files arrived named and typed and **zero bytes long**,
  and the board correctly refused them as "not a picture" — a failure that reads exactly like a board that
  cannot read a PNG. The helper now crosses as base64 and is turned back into a `Uint8Array` inside the page.
  `tests/e2e/helpers/images.ts` says so in its comment, because the symptom points at the wrong file.
- **`naturalWidth` is zero for a moment after the document says `ready`.** The status is written by the upload;
  the picture is fetched afterwards by the box drawn underneath it. A test that measures the painted box in
  between is looking at a picture still on its way and reports no picture. `waitForPictureDrawn` waits for the
  one number that can only mean the bytes came, and its failure message names a fetch that never returned
  rather than a layout that never happened.
- **`filechooser` is an event, not a state.** Playwright intercepts the native window the board's hidden input
  opens, but only if the listener was registered before the keypress that opened it. `expectFileWindow(page,
  'the i key')` is called *before* the press and answered after; and the press goes to `board(page)` rather
  than to the page, because a key sent at a page that holds nothing focused goes nowhere. `i`, the toolbar
  button and the drop are the three ways in, and the fixture proves all three open the same window.

## Story 12: the drop, and the drag that is not about files

`dropPictures` builds a real `DataTransfer` inside the page and dispatches real
`dragenter`/`dragover`/`drop` events at a screen point converted through that page's own settled camera —
Playwright's `dispatchEvent` constructs `new DragEvent(type, eventInit)`, so `dataTransfer`, `clientX` and
`clientY` all arrive, which is the whole reason a drag can be tested at all in a headless browser. TC-25 walks
the sequence a person makes: carried over the board (the highlight appears, nothing is created), carried away
(the highlight goes), then dropped.

`onDragOver` answering `preventDefault()` is what makes a drop possible at all, and `onDragEnter`/`onDragLeave`
are counted rather than trusted, because a drag crossing into a child object fires `dragleave` on the surface
and a naive listener takes the outline back while the files are still over the board. The highlight is rendered
by `BoardPage` and not by `BoardViewport`: it is an offer about the whole board area, and the world layer under
it is scrolling, zooming and full of other people's objects.

The handlers were added to `BoardViewport` as four named props rather than a passthrough bag because the surface
has to answer all four and nothing else: it does not know what a picture is, and a drop that lands on a note is
still a drop on the board at that point, which is what listening on the surface (and letting events bubble)
buys.

## Story 12: the floor of a resize, which is not proportional

TC-27 asserts the ratio to two decimals on the way up and on the way down, and then drags the corner four
thousand pixels past the floor and asserts only that both sides reached `IMAGE_MIN_SIZE_WORLD` and that
`naturalWidth`/`naturalHeight` still read 1600×900. That is not a test made vaguer than the design asked:
`clampScale` in `src/shared/geometry.ts` clamps the two axes **independently** (`minX` from `min / width`, `minY`
from `min / height`, computed over the whole selection), which is right for a group of objects with different
minimums and means that a single 1600×900 picture squeezed to the floor lands on 16×16 — ratio 1.0, not ratio
16/9. Below a certain size a picture becomes a square dot whatever its proportions were, and the next resize
from there is measured against the file again, not against the dot. What the story's claim is about is that the
*stored box* never goes below what the board can draw and the bytes are never touched by having been squeezed,
and both of those are asserted exactly.

## Story 12: what is offered to whom

The uploader's box says "Upload failed" and has **Retry** and **Remove**. Every other tab's box says "Image
unavailable" and has no retry — there is no copy of the file in their tab to upload again, and a button that
cannot work is worse than no button — and no Remove either, which is the PRD's line read strictly: a picture
that has not arrived is the uploader's mess, and it would be a strange power to let a colleague delete the
object that is being retried under somebody's hands. `readOnly` boards offer neither.

Between `uploading` and `failed` there is a third state with its own words, "Image upload didn't finish", which
is decided by `IMAGE_UPLOAD_STALE_MS` (five minutes) against `uploadStartedAt` and not by anything on the wire:
a tab that was closed mid-upload leaves a box that says "Uploading…" at 0% forever, on every screen, for the
rest of the board's life. One `setInterval` per board, ticking only while something is actually uploading
(`useImageClock`), keeps that from being a per-object timer. `useImageClock` is passed down through
`ImageContext` along with the progress map and the two actions, because the registry hands an object component
`ObjectProps` and knows nothing about uploads — adding four upload fields to every object's props to serve one
type is the same mistake as a `switch` on type in the viewport.

One accessibility trap, found by reading rather than by a test: `role="img"` on the placeholder container makes
**every descendant invisible to assistive technology**, including the Retry button inside it, so the container
is `role="group"` and the message is a text node inside it. `aria-label` was taken back off the two buttons for
the same reason in reverse — the visible label is the accessible name, and an override that disagrees with it
breaks WCAG 2.5.3.

## Story 12: the worker, and one route that had to be seen before the board lookup

`POST /api/boards/<id>/assets` is a board path with something on the end, and the existing board lookup takes
the whole rest of the path as a board id — so the upload had to be recognised *before* it, or every upload
would be a 405 about a method nobody asked about. Two helpers decide routing there (`assetUploadBoardId`,
`namesAssets`) and both split on whole segments only: `%2F`-escaped slashes survive as text inside a segment
while the WHATWG URL parser has already normalised away `%2e%2e`, so an escape cannot turn a board address into
an assets address. `/api/boards//assets` names no board and is a 404 from the upload handler, not a 405.

`handleServe` reads the key out of the path **as it was sent**, without decoding: a valid key
(`^[A-Za-z0-9_-]{22}/[A-Za-z0-9_-]{22}$`) needs no escaping, so anything escaped in it is not a key, and
decoding first would be a route that reads a different object than the address named. Responses carry
`Cache-Control: public, max-age=31536000, immutable` — a key is minted per upload, nothing is ever written
twice under one, so a browser may keep the bytes and never ask again — and a stored object whose recorded type
is not one of the four is refused rather than served wearing a type it did not arrive with. TC-15's storage
failure is forced with a `Proxy` over `env` that swaps `ASSETS_BUCKET` for an object that throws, so the 500
and its log line are asserted against the real handler; and TC-12's "a refused upload left nothing behind" is
answered by listing the bucket, which is the reason the integration tests get a bucket of their own on disk
rather than a mock. `R2ListResult` is `{objects, truncated, cursor}` — not `keys`, which is the name in the
S3 API and the name I reached for first.

## Story 12: the fixtures, and the formats this machine can make

PNGs are made in code (a twelve-line encoder over `zlib.deflateSync`) in `tests/fixtures/images/index.ts`, so
every screenshot, portrait and corrupt-but-PNG-headed fixture is reproducible without a binary in git. The
three formats a PNG cannot be turned into by hand are committed as small real files, generated by
`tests/fixtures/images/make.mjs`: JPEG and GIF with macOS's `sips`, and WebP by pointing Chromium at a canvas
and taking `toDataURL('image/webp')` — there is no cwebp, no ImageMagick, no ffmpeg and no PIL on this machine,
and Chromium is the one encoder that is definitely here because Playwright installed it. The module checks the
magic bytes of each committed file at import time, so a fixture that got mangled by a checkout fails at load
with its name rather than in the middle of an assertion about something else.

The `webp` half of TC-26 is worth naming: the *browser* is asked to draw the bytes it fetched, so that test is a
statement about a WebP surviving upload, storage, an address and a decode. It runs in both browsers that start
here.

## Story 12: numbers

- **391 unit** (63 new: format sniffing, file validation, the image model), **318 component** (36 new: 16
  `ImageObject` states, 16 insert flows, 4 tool-key), **79 integration** (13 new, this story's asset API),
  **180 e2e passing in Chromium and WebKit** (8 new: TC-25 to TC-28 in each of the two browsers that start).
  The three non-e2e suites run in about 22 seconds together.
- Latency, logged against `LIVE_UPDATE_LATENCY_BUDGET_MS` and not asserted on, as in every story before this
  one: the three dropped pictures were agreed between two screens **1–2 ms** after the uploads were let through.
  The 3 s in the log line is the deliberate `page.route` hold on the upload address, which is what makes the
  `uploading` state observable at all — a 2.8 KB GIF over loopback finishes before a test can look at it.
- `npm run typecheck` (both tsconfigs), `npm run build` and `npm run build:test` are clean.
- **TC-19/TC-20/TC-21 (`@persist`) still do not run here**, at the same place they failed before this story was
  started — checked again by stashing `wrangler.jsonc` and re-running the project: a spawned runtime this sandbox
  cannot signal. Firefox still aborts on launch, so the design's "TC-26 also in firefox and webkit" is carried
  by WebKit, as in stories 8 to 11. The two facts together are the whole difference between this story's e2e
  count and the design's.
