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
