# Notes

Decisions and judgement calls made while implementing stories 1 and 2 (story 2's start
below the `## Story 2` heading). The spec (`spec/`) is read-only, so anything that
needed interpreting is recorded here.

## Toolchain

- **Vite 8 + React 19 + TypeScript 5.9**, client output to `dist/client`, served by
  `wrangler dev` (`wrangler.jsonc` is assets-only; Worker code arrives in story 3).
- **`.npmrc` sets `legacy-peer-deps=true`.** npm 9.2.0 on this machine aborts on a
  peer-set conflict between `@testing-library/react` 16 and its peers; the flag keeps
  installation working. `@testing-library/dom` therefore has to be a direct dependency
  (it is a peer of `@testing-library/react` v16, not a transitive one).
- **One `vitest.config.ts` with two projects**: `unit` (node environment,
  `tests/unit`) and `component` (jsdom environment, `tests/component`, setup file
  loads `@testing-library/jest-dom`). `test:unit` / `test:component` select them;
  jsdom is deliberately not used for the maths tests.
- **Ports** all sit inside the allowed 20192–20207 range: the e2e `wrangler dev` runs on 20194
  (its inspector on 20195, which is still a localhost listener on 127.0.0.1), and
  `npm run preview` pinned to 20196. Vite's own dev server default (5173) is unused by
  the tests.

## Camera and rendering

- `camera.ts` is **pure maths only** (no DOM, no React), which is what makes TC-01 to
  TC-12 fast unit tests and lets the e2e spec re-use the same functions to predict the
  zoom label sequence.
- Camera updates are **coalesced to one React render per animation frame** in
  `useCamera`: pointer and wheel events update a ref immediately (so a rapid sequence
  of events accumulates exactly) and schedule a `requestAnimationFrame` flush. When
  there is no rAF (jsdom without rAF, hidden tab) it falls back to a 16 ms timer.
  Tests wait for the camera to settle before asserting on pixels.
- **Resize does not move the board**: the camera is the world coordinate at the
  *top-left* of the board area, and the world layer is
  `scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`, so a window resize
  changes only how much board is visible. Covered by an e2e test.
- **Dot grid**: `background-size = GRID_SPACING_WORLD * zoom`, and the position is the
  design's `-x * zoom mod spacing` shifted by half a tile, because a radial gradient
  paints its dot in the *centre* of the tile. Without that half-tile shift every dot
  would sit half a grid cell away from the world coordinates it is supposed to mark.
  The dot radius stays 1 CSS px at all zooms and its alpha fades as the grid gets
  denser, otherwise at 10% the dots (2.4 px apart) merge into a grey wash. Dot alpha
  does not change spacing, so TC-27's spacing assertion is unaffected.
- **Origin marker**: a zero-size element pinned to world (0,0) with a 17 px crosshair
  drawn by a child that is counter-scaled by `1 / zoom`, so the crosshair keeps a
  constant size on screen while its bounding box centre remains exactly the world
  origin — a stable, exact pixel target for the e2e tests (the design asks for a
  marker in all builds).

## Input handling

- **Wheel listener is attached natively with `{ passive: false }`** (React's `onWheel`
  is registered passive, so `preventDefault()` there is ignored and the page would
  scroll or zoom). It converts `deltaMode` lines/pages into CSS pixels with
  `WHEEL_LINE_DELTA_PX` / `WHEEL_PAGE_DELTA_PX`, pans for a plain scroll and zooms at
  the pointer for Ctrl/Cmd + scroll using `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
- **Safari pinch** uses `gesturestart` / `gesturechange` / `gestureend`; the starting
  scale is remembered so each event applies the ratio since the previous event.
  Playwright cannot synthesise a `GestureEvent`, so the handler is covered by the
  component test TC-17 (the design says the same).
- **Keyboard** shortcuts listen on `window` for Ctrl/Cmd with `=`, `+`, `-`, `_` and
  `0`, and are ignored while focus is in a text field, `select`, `textarea` or a
  `contenteditable`. `preventDefault()` runs on every match so the browser's own
  page zoom never fires (TC-31 checks `visualViewport.scale` and `devicePixelRatio`).
- **Drag only starts on empty board space**: `pointerdown` is accepted when its target
  is the viewport itself, so later stories can put objects in the world layer and stop
  propagation. Pointer capture is best effort — engines refuse unknown pointer ids, and
  the drag must still end cleanly, so capture calls are wrapped and `lostpointercapture`
  also ends the drag.
- **The controls are not the board**: `ZoomControls` stops `wheel` and `pointerdown`
  propagation, so a Ctrl+wheel over the panel is left to the browser and never zooms
  the board (TC-30).

## State, hint and the test hook

- `hasNavigated` latches on the first *user* camera change and is never cleared;
  the system changes (first sizing of the window, the test hook) do not dismiss the
  hint. The camera and the hint are per-visit in-memory state, so a reload returns to
  the reset view and shows the hint again — which is what PRD `nav.hint` asks for
  ("... until the page is reloaded").
- **`window.__vidi6`** (`setCamera` / `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`; `setCamera` ignores non-finite or non-positive
  input. Verified by building both modes: the production bundle contains no `__vidi6`
  string, the test bundle does. Vite dead-code-eliminates the whole block in production.
- The viewport carries `data-camera-x/-y/-zoom`, `data-grid-spacing` and `data-mode`
  attributes. They are a cheap inspection surface: the tests measure the camera the
  same way the renderer sees it instead of duplicating the maths in the test.
- Accessibility: the buttons are real `button`s with the exact accessible names
  "Zoom out", "Zoom in", "Reset view", disabled at the limits (so a click there is a
  no-op, TC-32), and the zoom label is an `aria-live="polite"` output.

## Browsers I could not run here

`playwright.config.ts` declares **chromium, firefox and webkit** projects as the design
requires, but on this host only Chromium can actually launch: the Firefox and WebKit
binaries are installed, their **system libraries are not** (`libgtk-3.so.0`,
`libepoxy.so.0`, `libjpeg.so.8`, `libwebp.so.7`, `libharfbuzz-icu.so.0`, `libGLESv2.so.2`),
and installing them needs root, which this account does not have (`sudo` is blocked by
a no-new-privileges flag). Rather than fail the suite, the config probes the dynamic
linker's cache and skips an engine with a printed reason:

```
[e2e] skipping "firefox": the host is missing libgtk-3.so.0
[e2e] skipping "webkit": the host is missing libgtk-3.so.0, libepoxy.so.0, ...
```

`E2E_BROWSERS=chromium,firefox,webkit` overrides the selection. The specs use nothing
engine-specific (no Chromium-only APIs), so they should pass in Firefox and WebKit on a
machine that can start those browsers — that has not been verified here.

## Story 2: board model

- **Test-first order**: tasks 1 and 3 (the unit tests) were written and seen red/green
  before the code they test; task 2's model came after task 1's tests, task 4's
  `StickyText` after task 3's tests. The component tests (task 7) were written after
  the components of tasks 5–6, which is the one place where the task list's order was
  not followed step by step — every behaviour listed there is nevertheless covered.
- **`createSticky(doc, at)` takes the centre** of the new note (double-click point or
  view centre) and stores the top-left, `at − STICKY_SIZE_WORLD / 2`, because
  `StickyNote` renders at `(x, y)`. `moveObject` also takes the top-left.
- **Non-finite coordinates are rejected**: `moveObject` returns `false` and writes
  nothing; `createSticky` cannot fail partially, so it returns the empty string (and
  `App` then does not select or edit anything). TC-39.
- **`bringToFront` on the note that is already topmost returns `false` and emits no
  update.** The design's drag test asks for exactly one update when a note below is
  dragged, and the `z = maxZ + 1` rule is still what the function does; a note that is
  already on top does not need a new slot.
- **`snapshot` returns a frozen array sorted by `(z, id)`**, so the id breaks a tie
  between equal `z` values and React's `key` order is stable. Text is copied into the
  snapshot, which is what lets the fit logic re-run on a text change.
- **`useBoardDoc` publishes `[doc, notes]`** as one memoised tuple: `useSyncExternalStore`
  compares `getSnapshot()` by identity, and a component always needs the doc as well as
  the notes, so both live in the same store. `observeDeep` fires *after* the transaction
  has been applied, so reading the map inside the listener is safe.
- `LOCAL_ORIGIN` is exported from `board-model` (the design places the origin constant
  there) and used by the editor.

## Story 2: notes, selection and creation

- **Selection and editing live in `useSelection`** in `App`, never in the document, and
  at most one note is ever selected or edited. Ending an edit takes `"selected"` or
  `"unselected"` so the component that ends it (Escape versus a click outside) decides
  what is left selected.
- **`App` also clears the selection when the selected note disappears** from the
  snapshot. Deleting a note from another tab would otherwise leave the outline,
  the toolbar and the keyboard pointing at a note that is gone.
- **`BoardViewport` stays object-agnostic**: it gained `onEmptyDoubleClick(point)` and
  `onEmptyClick()` instead of importing sticky-note behaviour. Both fire only when the
  event's target is the viewport itself, so an object that stops propagation is enough
  to keep the gesture.
- **A press on empty space shorter than `DRAG_THRESHOLD_PX` no longer moves the
  camera** (it used to pan by the full jitter). That is what makes "click empty space to
  deselect" leave the camera exactly where it was, and the notes use the same
  threshold, so one number decides when a press became a drag. Story 1's tests still
  pass with it.
- **The note's toolbar clears the selection through `onEndEdit('unselected')`** after it
  deletes the note, instead of adding a prop to the design's `StickyNote` signature.
- **Tab reachability**: a note is `tabIndex={0}` and focusing it selects it, so Tab +
  Enter edits a note without any pointer. `Enter`, `Delete` and `Backspace` are handled
  once, on `window` in `App`, so a clicked note and a tabbed-to note behave identically.
- **Long-press selects**: `contextmenu` on a note is prevented and selects it. A touch
  long-press produces it in Chromium, and there is nothing else to do on a board with
  no clipboard.
- **Drag maths**: the delta is measured in client pixels and divided by the zoom, from
  the note's position at pointer-down (not from its previous written position), so a
  drag cannot accumulate rounding error, and `pointerup` writes the final position once
  more so the note lands exactly under the pointer. `bringToFront` runs once, on the
  transition into Dragging.

## Story 2: text editing

- The editor is an **uncontrolled textarea**: React re-renders would reset the value in
  the middle of an IME composition. `onChange` (and `compositionend`) push the DOM value
  through `clampToLimit` and `applyTextDiff`; when characters are dropped the caret is
  restored to the end of what is really in the note.
- **Fit is measured with `scrollHeight` against `clientHeight`** of the text element, so
  CSS owns the box (12 world-unit padding, `overflow: hidden`, `white-space: pre-wrap`)
  and JS only owns the font size. The size is world units, so the note's text scales
  with the board — which is why zoom is deliberately not an input to the fit.
- **The bottom fade** is a `sticky-note__fade` element rendered by whoever measured the
  overflow: the note in display mode, the editor while typing (where `overflow` is true
  only at the 10 px floor).
- **A pointerdown outside the note** ends editing through a document-level capture
  listener in the editor (it compares the closest `[data-sticky-note]` ancestor), because
  clicking another note or a toolbar has to end editing too and the note itself keeps the
  click.
- jsdom specifics for the component tests: there is no layout (everything measures 0),
  no pointer capture (the harness routes moves to the element that received the press,
  like capture does) and React's value tracker swallows `element.value = …`, so the
  harness writes through the prototype setter before firing `input`.
- **`App` takes an optional `doc` prop** so a component test can inspect the very
  document the board is editing.

## Out of scope

Stories 6 and 13–17 (presence, offline device copies, sign-in, dashboard, comments,
export) are not implemented and nothing was added for them.

## Story 2 decisions

- **`Enter` inside the editor writes a newline; `Escape` or a click outside ends editing**
  (prd.md:48, design.md:424, tasks.md:86). The same key on a *selected note that is not
  being edited* starts editing (prd.md:90). Because both readings of "Enter" are live on the
  window, the window handler stands down whenever the focused element takes its own keys —
  a text field, or a button or link. Without that, pressing Enter on the delete bin pressed
  the bin *and* asked the board to start editing the note behind it.
- **`createSticky(doc, at)` takes the *centre*.** The stored position is the top-left, as
  `BoardObject` and the renderer need it, so the note is placed at `at - STICKY_SIZE_WORLD/2`
  and the click point ends up in the middle of the note. The double-click handler passes the
  raw world point without knowing the size.
- **The press is followed on `window`, not on the note.** Bringing a note to the front moves
  its DOM node to the end of the world layer, and the browser drops pointer capture when a
  node is re-inserted — the drag died on the first move. Listening above the tree survives
  the raise, and also survives the pointer leaving the note.
- **The note does not clip; its text does.** `overflow: hidden` on `.sticky-note` also cut
  off the toolbar, which floats above the note and is a child of it (the design puts the
  toolbar inside the note, and counter-scales it by `1/zoom`). `.sticky-note__text` and the
  textarea clip the text, which is the only thing that can overflow the note box.
- **`useSelection` holds selection and editing**, as React state, never in the shared
  document: they are per-user. `endEdit(next)` takes what the selection should be
  afterwards — `'selected'` for Escape/Enter, `'unselected'` for a click outside and for the
  delete bin — because the editor cannot know who is asking.
- **`Enter`/`Delete` are handled once on `window`** (in `App`) rather than per note: a note
  focused with Tab and a note clicked with the mouse then run exactly the same code, and the
  handler steps aside whenever the keystroke belongs to a text field.
- **Fit is measured with `scrollHeight > clientHeight`** on the element that holds the text,
  at the padding the CSS gives it (12 world units), stepping down through
  `STICKY_FONT_SIZES`. The CSS owns the geometry, the JS only picks the font size, so a
  change to the padding cannot silently change what fits. The text is never truncated in the
  document: only what is *shown* is clipped, and the fade marks it.
- **The counter is scaled back by `1/zoom` inside the world layer**, so it stays readable at
  any zoom without a second DOM. Same for the toolbar.
- **Notes expose `data-note-x/-y/-z`, `data-color`, `data-text-length`, `data-selected`** for
  the browser tests, in the same spirit as the camera attributes from story 1: the tests
  compare what the document says with what the browser painted, instead of trusting either
  one alone.
- **The `App` accepts an optional `doc`**, so a component test can inspect the real document
  while driving the real component tree; the production entry point passes nothing and gets
  its own document.

## Story 3 — live collaboration

- **`compatibility_date` is 2026-08-22, not the newest date.** The workerd that
  `@cloudflare/vitest-pool-workers` bundles refuses to boot on anything newer
  ("requires compatibility date 2026-09-01, newest supported is 2026-08-22"), and the
  integration tests are the reason that runtime exists here. Re-check both runtimes
  before raising it.
- **Worker code has its own TypeScript project.** `wrangler types` writes
  `worker-configuration.d.ts` (checked in), whose globals — `WebSocket`, `Response`,
  `Blob`, `console` — are workerd's, not the DOM's, and the two declarations are not
  interchangeable. `tsconfig.worker.json` compiles `src/worker`, `src/shared` and
  `tests/integration` with `lib: ["ES2022"]`, `types: []`; the root project excludes
  those paths. `npm run typecheck` runs both.
- **A room's sockets are set to `binaryType = 'arraybuffer'` right after `accept()`.**
  workerd hands WebSocket frames to a Durable Object as `Blob`s by default, and
  `decodeMessage` expects the bytes. `y-websocket` sets `arraybuffer` on the browser
  side itself, so this only ever affects the room and the in-worker test clients.
- **A test client must call `accept()` on `response.webSocket`** before sending on it
  ("You must call one of accept() or state.acceptWebSocket() …"). The socket handed
  back by an internal fetch is not owned by the caller until it does; messages sent
  before that throw, and messages arriving before it are buffered, not dropped.
- **The room writes the outer `MESSAGE_SYNC` byte itself.** `y-protocols`'
  `writeSyncStep1`, `writeSyncStep2` and `writeUpdate` write their own sub-kind but
  not the message type; `y-websocket` frames them as `type, sub-kind, payload`. A
  hello or a broadcast that skips the type byte is read by the client as garbage
  ("Unexpected end of array") and turns into a reconnect loop.
- **Awareness is length-prefixed, sync kinds are not.** `y-websocket`'s
  `messageAwareness` handler reads its body with `readVarUint8Array`, while
  `messageSync` hands the decoder straight to `readSyncMessage`. Decoding the
  awareness count directly (which is what `applyAwarenessUpdate` does with the
  *unwrapped* update) rejects every real frame.
- **An awareness entry is `clientId, clock, JSON state`** — the order
  `applyAwarenessUpdate` reads and `encodeAwarenessUpdate` writes. State is a
  `varString`, so an entry with a non-ASCII name is validated by character count,
  exactly as the library reads it.
- **`GET /b/<invalid id>` serves `index.html`.** The 400 in the contract belongs to
  `/api/rooms/:boardId`, which is a machine endpoint; the page route has to reach the
  SPA so it can say "That board address is not valid." — the page that says it is
  story 5's `BoardPage`.
- **The `/` redirect to a fresh board is temporary.** Story 5 owns board creation and
  the share button; story 3 needs *a* way to land on `/b/<id>` from a browser, and a
  redirect is the smallest one.

## Story 3 — text that arrives while a note is open

- **An open editor takes remote text into the field.** `StickyTextEditor` keeps its
  value in the DOM and writes it to the `Y.Text` with a whole-value diff
  (`applyTextDiff`). That is correct for one person and quietly destructive for two:
  if the document has moved on since the field was last written, the diff is
  computed against a stale copy and the next keystroke deletes whatever the other
  person typed. The editor now observes its `Y.Text`, writes remote text into the
  textarea and moves the caret with `shiftCaret`. The invariant that makes the
  whole-value diff safe again is that field, document and `sharedValueRef` agree
  between keystrokes, so a commit always describes a local edit.
  Found by e2e TC-23, not by any single-client test.
- **The same fix is why nothing is lost when text arrives mid-word.** With the field
  up to date, a keystroke's diff is one insert at the caret; without it, a keystroke
  is "replace the tail of the note with what I have".
- **`shiftCaret` treats a remote change as one region.** A caret before it does not
  move; a caret at or after it moves by what the change grew or shrank by. Pure, so
  it has unit tests, including one across a surrogate pair.
- **Composing text is left alone.** While an IME composition is running, incoming
  text is not written into the field — replacing what a person is mid-way through
  composing is worse than a short delay — so composing while somebody else types in
  the same note can still drop their characters. Fixing that means applying the
  local *operations* rather than a value diff, which is an editor integration, not a
  sticky note. Documented rather than hidden.

## Story 3 — the live-collaboration e2e suite

- **One browser context per person.** Two pages in one context could in principle
  meet through a `BroadcastChannel`, and the test would pass while the relay did
  nothing. `connectBoard` sets `disableBc`, so the isolation is belt-and-braces; the
  contexts mean the test does not have to know that.
- **Notes live on a grid and people act on their own.** `noteWorld(person, slot)`
  puts notes 260 world units apart, more than a note's 200, so a click can only ever
  be a click on the note it names. Every e2e edit is a click, so this is what makes
  multi-person tests deterministic; the capacity soak moves each note back towards
  its own grid point instead of letting it random-walk into a neighbour.
- **`waitForChange` waits and times.** Every cross-person assertion goes through it:
  poll to `E2E_EVENTUAL_TIMEOUT_MS`, then log the elapsed time against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` with a within/over verdict. It never fails on
  latency — five browsers, the app, the Worker and the model share one machine — and
  fails only on a change that never arrives.
- **Never `fill()` a shared field in a test.** Clearing a textarea is a local edit to
  a shared note, so a test that "starts clean" deletes the other person's typing. The
  helper types with the keyboard into whatever is there.
- **Selection and the editor are local, and stay that way.** TC-28 is a negative
  test: the text travels, the caret and the highlight do not. It belongs in e2e
  because the claim is about two screens.
- **`expect.poll` needs the long budget here.** The default 5 s is enough alone and
  not enough with three workers on one machine; every poll in this suite passes
  `EVENTUALLY` so a loaded machine slows a test rather than failing it.
- **An outage is two things.** `context.setOffline(true)` alone leaves the socket
  standing until it times out, which is minutes. `goOffline` also tells the board to
  drop the connection, as a real drop would; the badge reaching "Reconnecting…" is
  the assertion that the drop actually happened.

## Story 3 — the nightly run

- **`test:e2e:nightly` is a second Playwright config** (`playwright.nightly.config.ts`)
  over the same directory: one worker, `testMatch: nightly.spec.ts`, and
  `testIgnore: []` to undo the main config's ignore — a file has to match `testMatch`
  *and* not match `testIgnore`, so forgetting that gives "no tests found".
- **Durations are real by default and compressed by `NIGHTLY_SHORT=1`** (45 minutes
  becomes 45 seconds, `NIGHTLY_SHORT_SCALE` in config). The nightly job does not set
  it; the flag exists so the tests can be checked while being written.
- **The soak edits through the UI with the integration fixture's seeded generator**,
  in the mix the design asks for (40% typing, 30% moving, the rest creating,
  recolouring, deleting). The check after each edit is the whole board, not the note:
  convergence is the claim, and comparing shapes catches the things a per-note
  comparison misses.
- **Re-joining is asserted as a drop first.** A person is not counted as having
  re-joined unless their state left `confirmed`, so the test cannot pass by never
  leaving.

## Story 3 — two things the soak found that are not story 3's to fix

- **A selected note's toolbar can be covered by its neighbours.** The toolbar floats
  about 34 units above the note, inside the note's own layer, so a neighbour with a
  higher `z` sitting over that band takes the click. It bit the soak's colour swatch
  clicks on a 260-unit grid; the soak now uses a 400-unit grid (`SOAK_SPACING`) and
  does not depend on it. The product question — should the selected note and its
  toolbar be raised above the rest while selected — belongs to story 2's selection
  design, and changing it on the way through a sync story would be a change nobody
  asked for. Left as a note, not a fix.
- **Playwright's default action timeout is no timeout.** A locator that never matches
  — a colour renamed, a button that only appears in another state — did not fail the
  run, it waited. On a nightly run that starts at three in the morning that is a run
  with no result, so `playwright.config.ts` now sets `actionTimeout` and
  `navigationTimeout`.


## Story 4 notes

### `tsconfig.worker.json` was excluding the files it existed to check (fixed here)

Story 3 added that project with `"exclude": ["src/worker", "tests/integration", ...]` on the
**base** config, expecting the worker project to override it. It did not: the child inherited
the base `exclude`, which filtered its own `include` list back down to `src/shared`. So
`npm run typecheck` never typechecked `src/worker/**` or `tests/integration/**` — and the
moment the workerd globals were really applied, two standing errors appeared (an unused
import, and a private method called from `connectRoom`). Both are fixed; the worker project
now sets `"exclude": []`. Nothing was deleted and no rule was loosened.

### A missing update is a hole in a document clock, and Yjs refuses to fill it silently

An update says which clock position it starts at. If the update before it was never applied,
everything after it from that client is parked as a hole and the document looks empty — with
no error. That bit the test fixtures first (`record(doc)` was attached after `initDoc(doc)`, so
every generated board replayed as an empty board and every comparison against it passed while
meaning nothing), and then it shaped TC-09: quarantining a row in the **middle** of a log does
not leave the rest of that author's work, because the rows after it cannot be applied.

Consequences written into the tests:
- `tests/fixtures/boards.ts` attaches its recorder before the first change, and the
  `replay()` helper in `tests/integration/board-store.test.ts` asserts that replaying produced
  as many notes as the board had. A generator that loses an update now fails loudly.
- TC-09 has three cases: a damaged **last** row (board complete apart from that update), a
  damaged **middle** row on a board written by **two** clients (the author who was not damaged
  keeps every note; the board still loads), and random bytes. This is what the storage layer
  can actually promise; the room's behaviour on top of it is TC-16/TC-24.

### A store that has not read its board does not know its log size

`logStats()` and `compactIfNeeded()` used the in-memory counters, which start at zero, so a
fresh `BoardStore` reported "nothing to compact" about a board with 500 rows. Now an instance
that has not run `load()` measures with `COUNT(*)`/`SUM(bytes)` once; the loaded instance keeps
the in-memory numbers, so an append still costs no query.

## Story 5 — sharing a board

### An address that cannot name a board, and one that names none, are one fact

`GET /api/boards/<id>` answers 404 both for an id that cannot be a board id and for one that
is well formed with no board behind it. Story 3's room route (`/api/rooms/<id>`) answered a
malformed id with 400; it answers 404 now, for the same reason: from outside, both arrive at
the same place for a person — the address they typed or pasted has no board behind it — and a
404 gives a stranger no extra information about which of the two it was.

The client's existence check goes one step further and answers *not found* without making a
request when the id cannot be a board id. A typo then costs no round trip, and — the part that
matters — it cannot be mistaken for "the service is not answering", which is the one answer
the page is allowed to keep retrying.

### The check is a loop the page owns, and the answers it gets carry the board's name

`BoardPageState.checking` carries a `boardId`, and `nextBoardPageState` takes the board id
as well as the answer, so a `ready` state cannot name a board other than the one that was
asked about — the state machine is self-contained, and a stale answer about some other
board cannot open a document the viewer has no business opening. The two-parameter version
in the design contract is otherwise unchanged.

The waits are `BOARD_CHECK_RETRY_BASE_MS` (1s) doubling per failed check up to
`RECONNECT_MAX_BACKOFF_MS` (10s) — the same ladder the WebSocket reconnect already uses, so
"the service is quiet" behaves like one thing in this app rather than two. There is no
attempt cap and no slide into *Board not found*: only the server's own 404, or an address that
cannot name a board, ends the wait. A minute of outage leaves the person on "Couldn't reach
vidi6. Retrying…", which is true, and on the board the moment the service returns (TC-20,
TC-28).

### Who creates a board, and when

`BoardRoom.initialize()` is the only thing that makes an address a board: it creates the
room's tables and writes `created_at`, and it answers `created` or `exists`, which is why it
is idempotent by construction rather than by luck. It is called from exactly one place in the
product — `POST /api/boards`, over Durable Object RPC — and the 201 that carries the new id
*is* the proof the board exists. A 500 there is a board that was not made, and the home page
says so (TC-09).

Because creation is the only entrance, connecting is no longer one: a socket to an address
that is not a board is refused with 404 by the room itself (`exists()` asks the storage, and
storage is the record). That is the change story 3's tests had to absorb — every room test now
initialises its board before opening a socket, which is also what the browser does before it
has a socket to open. "Is this board there?" therefore has one author and one answer, and a
page that reloads mid-check or opens the same link in two tabs is asking a question the room
is always in a position to answer truthfully.

### Legacy boards: a log with updates and no creation row is a board

Story 5 is the first story to ask "does this board exist?" at all, and the answer cannot be
only "there is a `created_at`" — a board whose updates were saved before that marker existed
is still somebody's board. `BoardStore.existsReadOnly()` therefore says *yes* if `created_at`
is set **or** there is saved content: an update row or a snapshot chunk. It reads, and it
never writes; a page checking an address must not be the thing that changes it.

Making a legacy board in a test needs a hook, because no product path can: `POST
/__test/boards/<id>/seed-legacy` writes real updates (produced by the same model the app uses,
base64 in the request body, decoded by `decodeLegacyUpdates`) with no creation marker anywhere.
It exists only when the runtime is started with `TEST_HOOKS:1`, which is why
`playwright.config.ts`'s `webServer` now passes `--var TEST_HOOKS:1` — the TC-31 board cannot
be conjured any other way.

### The Share panel is one control

`SharePanel` renders its own **Share** button and owns its open/close state: the button and
the panel are two faces of one action, and splitting them across files would only move the
question "is it open?" somewhere further away. Opening moves focus to the link (already
selected, so a person can type over it or copy it as-is); closing returns it to the Share
button — keyboard or mouse, same path. `boardLink()` lives next to it and `boardPath()` in
`router.ts`, with the route parsing that defines what a board address *is*.

Home navigates with `navigate()` (push), not a replace: pressing **New board** is going
somewhere, not exchanging one address for another, so Back returns to Home and forward lands
on the board again (TC-16's navigation, and the same path TC-27 uses from *Board not found*).
The story 4 test that relied on `/` showing a board still passes because `App` takes the board
from the address bar unless a `boardId` prop was handed to it.

`<meta name="referrer" content="no-referrer">` went into `index.html`: the address *is* the
access control, so nothing a person opens from a board page is told where the link came from
(TC-32). It is `no-referrer` rather than `same-origin` because the board id travels in the
path, and a same-origin policy would still hand it to anything embedded cross-origin.

### Where the harness, not the product, was wrong

- **Spies on a Durable Object class**: mocking `BoardRoom.prototype.initialize` to reject
  leaves an unhandled rejection behind — `vitest-pool-workers` hands you a callable-thenable
  wrapper, and the rejection arrives on a path no test awaits. The injection is done on the
  namespace instead (`vi.spyOn(env.BOARD_ROOM, 'get')`), which is where the failure a test
  wants to simulate actually happens: "the room could not be reached".
- **A log line that arrives after the test file closed**: `EnvironmentTeardownError:
  Closing rpc while "onUserConsoleLog" was pending`. Every test had passed; the *file* was
  reported failed, and occasionally the runner wedged instead. Rooms log as they work, so
  both files that talk to real rooms now pause briefly in `afterAll` to give lines already
  in flight somewhere to arrive. Eleven consecutive clean runs afterwards, zero before.
- **A moment of agreement is not convergence** (the capacity test in
  `tests/integration/board-room.test.ts`, exposed by story 5's changed timings): the capacity test waited until every client's board equalled client 0's
  and then asserted — with updates still travelling, an assertion taken a beat later saw two
  boards that had moved apart. `waitForSettledBoards()` requires the boards to agree and then
  to *keep* agreeing through a quiet period. Genuine divergence still fails it, with the seed
  printed.
- `BOARD_ID` (the id pattern with its anchors removed) is exported from
  `tests/e2e/helpers/board.ts` so a spec can build a URL pattern without producing `$$` and
  matching nothing.

### Browsers

Chromium only, as in stories 1–4: the Firefox and WebKit binaries are installed but this host
is missing their system libraries, and there is no root (`sudo` is blocked by a
no-new-privileges flag), so `playwright.config.ts` skips those projects with a printed reason.
This costs the run nothing the design asked for: the design's own not-covered list puts real
Safari and Firefox clipboard behaviour out of scope and has the e2e suite force the fallback
path deterministically instead (TC-29 stubs `writeText` to reject, TC-24 covers a clipboard
that is absent altogether).

### What was tested where

TC numbers are design.md's table, not tasks.md's (the two differ for this story; the design
is authoritative). As implemented: unit `create-board.test.ts` TC-04; integration
`board-api.test.ts` TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32; ui-component `pages.test.tsx`
TC-16, TC-17, TC-19 to TC-21 and `SharePanel.test.tsx` TC-22 to TC-25; e2e `share.spec.ts`
TC-26 to TC-29 and TC-31. **TC-30 does not exist** — the design's table goes TC-29 → TC-31, and
the many-people claim is story 3's nightly TC-26. TC-17 is written as the two runs the design
names (a 500 and a network failure) via `describe.each`: both arrive at the page as
`{kind:'failed'}`, which is the point — the page does not distinguish them and must not.

## Story 7 — selecting, moving, resizing and deleting several objects

### The design's `onGestureStart` / `onGestureEnd` became one piece of state

The transform contract names two callbacks so the chrome can get out of the way while a
group is being dragged. In React the thing that has to change is what is *rendered*, so
`useTransformGesture` returns `isTransforming` and `App` reads it: the selection bar is
hidden while it is true, and the viewport gets `.transform--active` for the grabbing
cursor. The callbacks would have been a second, imperative copy of the same fact, and
they would have had to be kept in step with a render anyway. TC-26's "exactly once per
drag" is asserted on the state instead: false → true once, true → false once, and
`pointercancel` mid-drag leaves the last applied positions alone.

`isTransforming` turns on at the drag *threshold*, not at pointerdown. A click is a
selection change and nothing else; a bar that vanished and reappeared under every click,
and a cursor that flicked to `grabbing` for the length of a press, were both consequences
of setting it too early.

### `canEdit` had nowhere to live, so story 4's gap is filled here

TC-25 needs a board state — "this board could not be loaded" — that story 4 introduced
the badge for but never modelled: `ConnectionState` had no such case, so nothing could
refuse a gesture for want of a document. `connectBoard.ts` now reports `load_failed` when
the room closes the socket with 4500 ("this board could not be loaded"), the badge says
so, and `canEdit(state)` is false for it, for `offline` and for `read_only`.

`canEdit` is exported from `ConnectionStatus.tsx`, not from `connectBoard.ts`, and that is
deliberate: `tests/component/pages.test.tsx` replaces the whole `connectBoard` module with
a mock, and a re-export through it disappears with the mock. The design puts the function
beside the badge anyway — it is a fact about what the connection text means.

### Aspect lock follows the axis the pointer moved further along

`resizeRect(..., aspectLocked: true)` has to answer "how much of the box is left" from one
pointer delta. The rule used is the dominant axis by absolute delta magnitude: pull the
south-east handle 200 across and 50 down and the box's width is what you set, the height
follows the original ratio. Scaling the box by the *larger of the two resulting scales*
sounds equivalent and is not: it makes a small vertical tug on a wide selection jump the
width, and it is uncanny. Equal magnitudes count as that axis — a diagonal pull grows both.

Everything else follows from clamping that one scale: `clampScale` picks the biggest scale
that puts no object under its type's `minSize` or over `MAX_OBJECT_SIZE_WORLD`, and
`scaleWithin` applies that same scale to every object's rect, which is why the gaps between
notes scale with the notes (TC-04, TC-33).

### One `ObjectProps`, narrowed by the component

`ObjectProps.obj` is an `ObjectSnapshot` — the widest thing the model can read — rather
than a generic parameterised by type. A generic registry would have had to carry the
snapshot type through `ObjectTypeSpec`, `getObjectType`, the overlay and the renderer to
type-check what is already known at the call site, and the payoff would have been nothing:
a component cannot be handed an object of a type it does not implement, because the board
only renders objects whose registered spec names *it*. `StickyNote` narrows once with
`asSticky(obj)` and returns `null` if the object is not a note it can draw. The board
filters the snapshot through the registry once, in `App`, so nothing downstream has to
wonder whether it is being handed something unknown.

### The selection is a reducer with a `presentIds` guard

`SelectionState` carries `ids`, `editingId` and `presentIds` (the ids the snapshot still
has). Every action except `add` refuses an id that is not present, so an object that
another person deleted mid-gesture cannot be selected by a click that was already in
flight — and the prune effect that follows removes it from the set anyway (TC-15, TC-16,
e2e TC-35).

`add` is the exception, and exists for one real sequence: the toolbar creates a note and
`App` selects and edits it in the same click, before any snapshot containing it has
reached the reducer. Without the exception TC-28's "create then immediately edit" loses
the edit — and this is the bug that the guard itself would have caused.

Selection is never written to the Y.Doc. It is this person's view of the board, and the
five-person e2e (TC-36) is only meaningful because nobody's selection is anybody else's.

### Where the chrome lives, and why the DOM order matters

The outlines, the bounding box and the eight handles are drawn in **screen** space
(`SelectionOverlay` converts every rect with `worldToScreen`), because a handle is 8 CSS
pixels at 10 % zoom and at 400 % — `HANDLE_SIZE_PX` could not be expressed in the world
layer at all. The marquee is the opposite case: it is glued to the board while it is
dragged, so `MarqueeRect` lives *inside* the world layer and divides its own border width
by the zoom to stay one pixel on screen.

The note toolbar moved out of `StickyNote` into the board-level `SelectionBar`: only the
board knows the camera, and the bar has to float above the *selection's* bounding box,
which for a group is not any one note. It also means one sticky selected and six selected
are the same component deciding what to offer.

`.selection-anchor` is rendered **before** `SelectionOverlay`, deliberately: DOM order is
tab order, and story 2's keyboard-only test walks from a note to its colours and its bin.
Eight new tab stops in front of them would have buried the delete button in a run of
resize handles. z-index, not this order, decides what is drawn on top.

The outlines used to carry `data-object-id` as well as their own test id. They do not now:
`[data-object-id]` means "an object on this board" and nothing else, which is what both
`stickyHarness.noteElements()` and the e2e helpers need it to mean. They carry
`data-outline-id` — a decoration pointing at an object, not the object.

### Two small rules that turned out to matter

**A press on a member of a multi-selection narrows to it — but only if it was a click.**
Press one note of six and drag: all six move. Press it and let go: the selection becomes
that one note. That is what every canvas does, and it is the only way to get from a group
back to one object without clicking empty space first. TC-23's threshold boundary
(`DRAG_THRESHOLD_PX − 1` is a click, exactly `DRAG_THRESHOLD_PX` is a drag) is what the
rule is hinged on.

**A cancelled press does not clear the selection.** An empty-space pointerdown that ends in
`pointercancel`, or that pans the board, is not "a click on nothing". Only a press that
started on empty space *and* stayed there clears, which is TC-19 — and the distinction is
what stops a pan from throwing away a selection someone had just made.

### Things the tests, not the product, had to learn

`renderStickyApp(doc, boardId)` takes a board id now. Without one the document has no room
and `connectBoard` is never called — correct for a local board, and it meant TC-25's fake
`WebSocket` was never constructed. Give the harness a `boardId` and the provider really
connects, so the stub can refuse it with 4500 and the board really refuses the gestures.

The e2e helpers (tests/e2e/helpers/selection.ts) read the board rather than the app:
`selectedIds`, `outlineCount`, `handleCount`, `objectIdAtPoint` ("what is painted uppermost
here", the one fact only a browser can give), `marqueeStart`/`marqueeEnd` so the rectangle
can be looked at while the pointer is still down, and `placeNotes`, which double-clicks
notes into existence and works out which id is new by polling — reading once, too early,
was a flake of mine, not of the app.

### Deviations, stated

- **TC-35 uses four notes, not the design's 20-note fixture.** The behaviour under test is
  that a remote delete prunes my selection through the real sync path, and it is the same
  at four notes or twenty; twenty would be seeded by twenty double-clicks. The five-person
  fixture scale is TC-36, which does run at `MAX_CONCURRENT_EDITORS`.
- **TC-34 presses `Shift+ArrowRight` as well as `Shift+ArrowUp`.** tasks.md names
  `ArrowRight ×3` and `Shift+ArrowRight` (x only); the y step is asserted too, because
  `NUDGE_LARGE_STEP_WORLD` deserves a boundary in both axes.
- **Firefox and WebKit are skipped on this host**, as in every story before it: the
  binaries are installed, the system libraries are not, and there is no root.
  `playwright.config.ts` prints the reason. TC-32 is written so that it will run on those
  engines wherever the libraries exist — it uses no engine-specific anything.

### What was tested where

Unit: `tests/unit/geometry.test.ts` TC-01 to TC-04; `tests/unit/board-model-group.test.ts`
TC-05 to TC-10; `tests/unit/registry.test.ts` TC-11, TC-12 plus duplicate registration;
`tests/unit/selection.test.ts` TC-13 to TC-15. ui-component:
`tests/component/selection.test.tsx` TC-16 to TC-22 and TC-27 to TC-31;
`tests/component/transform.test.tsx` TC-23 to TC-26; `tests/component/registry.test.tsx`
TC-11, TC-12 as rendered. e2e: `tests/e2e/selection.spec.ts` TC-32 to TC-36. So TC-01 to
TC-36 are all present, no layer claiming a case that another layer owns.
