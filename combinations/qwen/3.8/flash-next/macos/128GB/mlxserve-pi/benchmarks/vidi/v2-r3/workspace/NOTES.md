# Story 1 — Pan and zoom around an infinite board: implementation notes

## Camera model

- `Camera = { x, y, zoom }` where `(x, y)` is the **world coordinate at the
  viewport's top-left corner**. `worldToScreen(p, c) = (p - c) * zoom`,
  `screenToWorld(s, c) = s / zoom + c`. All camera math lives in
  `src/client/canvas/camera.ts` as pure functions (no DOM, unit-tested).
- Zoom is clamped to `[ZOOM_MIN=0.1, ZOOM_MAX=4]`. After every zoom the value
  snaps to the nearest power of `ZOOM_STEP_FACTOR=1.25` when within 2 % — so
  the 100 % → 125 % → 156 % … button ladder lands exactly on powers and the
  button sequence terminates at 400 % / 10 % (this is what makes
  `+`/`−` disable deterministically at the bounds).
- Wheel zoom uses `factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY *
  pixelsPerLine)` with `deltaMode` conversion (lines/pages → px). Trackpad
  pinch on browsers that send `ctrlKey` wheel events falls out of the same
  formula; Safari's `gesturestart/change/end` events are handled separately
  (each `gesturechange` zooms by the scale *ratio* around the pointer) and
  `preventDefault`-ed so the page zoom never changes (TC-24/TC-31).
- Camera mutations are coalesced: a mutable `cameraRef` is updated per event
  and one `requestAnimationFrame` per frame flushes a `setState`. A drag of
  N pointermove events renders once — and because the ref is updated
  immediately, consecutive drags never lose deltas (exactness of TC-23).

## Initial centring and resize

The camera starts at `{0, 0, 1}` and, as soon as the real viewport size is
known (first non-zero `ResizeObserver` report), becomes
`{x: -w/2, y: -h/2, zoom: 1}` — the board's start point sits at the screen
centre. Later resizes deliberately do **not** move content (design decision);
the once-guard also checks `cameraRef.current === INITIAL_CAMERA`, so a
camera set explicitly (e.g. via the e2e test hook) is never clobbered by a
late-flushing centering effect.

## Rendering

- One world layer with `transform: scale(zoom) translate(-x, -y)` and
  `transform-origin: 0 0` — pan and zoom cost nothing and work uniformly at
  1,000,000 units.
- The dot grid is a `radial-gradient` background on the surface:
  `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position = mod(-x*zoom, spacing)` — the modulo keeps every CSS
  number small at any world distance (TC-27).
- The origin crosshair is a world-space marker with
  `transform: scale(1/zoom)` so it keeps constant screen size at any zoom.
  A second marker at world `(1e6, 1e6)` is rendered **only in test builds**
  (`import.meta.env.MODE === 'test'`).

## Test hook

`installTestHooks` (`src/client/canvas/testHooks.ts`) exposes
`window.__vidi6.getCamera/setCamera` for e2e camera teleporting (TC-26/27).
It is imported by `App.tsx` only under `import.meta.env.MODE === 'test'`,
and is verified absent from the production bundle (`grep __vidi6` on
`npm run build` output). `npm run build:test` = `vite build --mode test`;
Playwright's `webServer` runs it behind `wrangler dev` (same asset-serving
path as production Cloudflare Pages).

## Component props superset (deviation from design.md)

Design sketches `BoardViewport` with a `children`-only contract. The
implementation takes `camera` plus interaction callbacks
(`onBeginPan/onPanMove/onEndPan/onWheel/onZoomAtPoint/onZoomStep/onReset/
onViewportSize`) instead of owning the camera itself. This keeps the
component a pure renderer, lets `ZoomControls` and the hint share one camera
state (`useCamera`), and makes both testable. `useCamera` additionally
exposes `zoomAtPoint(point, factor)` for Safari gesture events.

## Test-environment findings (worth knowing)

- **WebKit stale renders:** pointer events are processed synchronously into
  the camera ref, but the DOM render lands a frame later, and WebKit's CDP
  reads can lag input handling. Geometry assertions must first wait for the
  world-layer transform to match `__vidi6.getCamera()` (`settle()` in
  `tests/e2e/helpers/board.ts`) and then poll (`expect.poll`), otherwise a
  ctrl+wheel zoom measured from a stale frame looks 120·zoom px off. With
  that, e2e passes on both Chromium and WebKit.
- **Firefox cannot launch at all in this sandboxed macOS box** (even outside
  Playwright). The `firefox` project exists in `playwright.config.ts` for
  real CI, but `npm run test:e2e` runs `--project=chromium --project=webkit`
  so the suite is green where firefox won't start.
- **Disabled-button click race:** clicking `−` until disabled must not loop
  on `isEnabled()` (the button can become disabled between check and click
  and the click waits forever); the test clicks with a short timeout and
  breaks on the first timeout.

## Grid/keyboard behaviour summary

`Ctrl/Cmd + =/+/−` zoom one step (1.25× / ÷1.25, clamped+snapped),
`Ctrl/Cmd + 0` resets the view; all `preventDefault`-ed so the browser's own
page-zoom shortcuts stay out of the way. Wheel events over the board are
handled with `passive: false` and always `preventDefault`-ed (page never
scrolls/zooms over the board). Non-primary buttons don't start a pan;
`setPointerCapture` failures (WebKit+CDP) degrade gracefully.

## Verification

- `npm run test:unit` — 18 camera tests (TC-01…TC-12 + property check)
- `npm run test:component` — 16 tests (TC-13…TC-22, TC-29, TC-30, …)
- `npm run test:e2e` — 8 tests = TC-23…TC-28, TC-31 × (chromium, webkit)
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass.

---

# Story 2 — Capture ideas on sticky notes and rearrange them: implementation notes

## Document model (`src/shared/board-model.ts`, Yjs)

- One `Y.Doc` per board session. Objects live in `ymap` (`Y.Map<Y.Map<any>>`),
  the creation order counter in `meta.nextZ`, the local cursor in `cursor`
  (a `Y.Map` with `lastActive` in the model but never written by this story).
- `stickyNote.text` is a `Y.Text` so characters merge per-operation; everything
  else is a plain key on the object's inner `Y.Map`. Position is `x`/`y`
  (**top-left corner**, board units), stacking is the integer `z`.
- Every read (`snapshot`, `noteText`, `getMaxZ`) and every write goes through
  `transact`/`withOrigin`, which sets a module-level `activeOrigin` so nested
  calls reuse the transaction instead of trying to open a second one (Yjs throws
  on `transact(doc, …)` from inside a transaction). Origin rules: local
  `create/move/setColor/delete` and remote presence use the caller's origin,
  text edits always use `LOCAL_TEXT_ORIGIN = 'sticky-text'`, and a nested call
  whose transaction is already open inherits it. That is how a collaborator's
  `Y.transact(doc, 'remote', …)` still gets `remote` for the whole update.
- Writes are minimal: `moveObject` skips the write when `x`/`y` are unchanged
  and `setNoteColor` when the colour already matches, so a drag that jitters
  back to its start emits nothing. `applyTextDiff` keeps the common prefix and
  removes the rest before inserting the common suffix, so typing one character
  emits one `retain`+`insert`, never a rewrite.
- `snapshot` returns notes sorted by `(z, id)`. **The board deliberately does not
  render in that order** (see pointer capture below).

## Text fitting (`src/client/objects/StickyText.ts`)

`fitFontSize(text, boxWidthPx, boxHeightPx)` binary-searches 1 px steps between
`STICKY_FONT_MIN_PX` (10) and `STICKY_FONT_MAX_PX` (24) using a cached canvas
2D context with the note's font stack, so it works with no layout at all: line
widths are measured with `measureText`, and the height budget is
`lines * 1.35 * size`. It returns `{fontPx, overflow}`, where `overflow` is "no
size fits", which is what drives the fade. `clampToLimit` slices by grapheme
(`Intl.Segmenter` when present) so a pasted emoji is never cut in half.

## Dragging a note and pointer capture (the one real trap)

Bringing a dragged note to the front changes its `z`, which changes the order of
the keyed children, which makes React **move the note's DOM node** out of and
back into the document — and moving the capturing element out of the document
fires `lostpointercapture` and ends the drag after the first pointermove. In
Chromium this silently froze the note 5 board units behind the pointer.

Fix: the board renders notes in a **stable order (by id)** and paints stacking
with `zIndex: note.z` on the note element instead of relying on DOM order
(unique `z` per creation, `bringToFront` = `maxZ + 1`, so painting is identical).
`snapshot`'s `(z, id)` order is kept for tests and for any future renderer.
`bringToFront` is called once, at the moment the drag crosses
`DRAG_THRESHOLD_PX` — not on every move.

Pointer capture is best-effort (`try/catch`): without it the note still follows
the pointer, because the note's own `pointermove` keeps firing while the pointer
is over it. The board surface ignores pointermove unless *it* captured the
pointer, so a note drag can never turn into a pan even after capture is lost.

## Text editing

- The textarea is **uncontrolled**, seeded with the note's text, because
  re-rendering a controlled textarea mid-IME-composition is the classic way to
  duplicate characters (TC-24). Every `beforeinput`/`input` (composing or not)
  flushes the whole value through `applyTextDiff`, which only emits the
  difference and clamps to 1,000 characters — so the 300 ms IME test in e2e
  types 5 CJK syllables and lands exactly `你好世界吗`.
- `Escape` while `e.isComposing` (or between `compositionstart` and
  `compositionend`) is ignored: WebKit/Chromium send Escape to cancel the
  composition, and that must not end editing (TC-38).
- `onDoubleClick` on a note bubbles to the board surface but is ignored there,
  because the surface handler requires `event.target === event.currentTarget`.
  The same guard covers `pointerdown`, so a note press never reaches the pan
  logic; the note calls `stopPropagation` anyway.
- While editing, the display text is `visibility: hidden` (not `display: none`)
  so `fitFontSize` can keep measuring it and the text shrinks as you type.

## Constant screen size for the note toolbar

`StickyNote` publishes `--note-inv-zoom: 1 / zoom` on the note element and
`.note-toolbar` uses `transform: scale(var(--note-inv-zoom, 1))` with
`transform-origin: bottom left`. `useBoardDoc` re-renders on camera changes
(camera `onChange → sync`), so the inverse stays current at any zoom; TC-34
measures a swatch's bounding box at 100 % and 200 % and gets the same size.

## Test seams and helpers

- `App` takes an optional `onDocReady(doc)` (used only by component tests).
- `tests/e2e/helpers/stickies.ts` keeps every geometry assertion in board/screen
  space: `expectMovedBy` (screen delta equals pointer delta, i.e. the grabbed
  point stays under the pointer), `expectWorldAt`, `noteFontPx`,
  `noteHasFade` (getComputedStyle mask-image), `textBoxInside`
  (bounding box inside the note + scrollHeight > clientHeight for the clipped
  case), `topNoteIdAt` (`document.elementFromPoint`) and `cameraOf`.
- `createNoteAt` returns the *new* note's id (ids before/after), so it works
  with notes already on the board.
- Component tests drive the drag with real `PointerEvent`s (jsdom has no
  `setPointerCapture`, so the code path under test is the fallback branch) and
  flush `requestAnimationFrame` explicitly.

## Verification (story 2)

- `npm run test:unit` — 53 tests (TC-01…TC-12, TC-39, TC-13…TC-17)
- `npm run test:component` — 53 tests (adds TC-18…TC-29, TC-35…TC-38)
- `npm run test:e2e` — 15 tests × (chromium, webkit) = TC-30…TC-34 plus
  recolour/bin-delete/toolbar-size/multi-line/paste-limit workflows
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass; the
  `__vidi6` hook is still absent from the production bundle.

---

# Story 3 — other people's changes, on the same board

## Where the room lives, and what it shares with the client

`src/worker/index.ts` routes `/api/rooms/:boardId` to a `BoardRoom` Durable
Object and answers anything else from the static assets. The room holds one
`Y.Doc` per board and is the only thing connecting people: it relays Yjs updates
to every socket but the one that sent them, and relays awareness (presence)
verbatim to everybody, including the sender, which is also what keeps an idle
connection from being reaped.

`src/shared/protocol.ts` is shared by the client, the room and the tests: it is
y-websocket's own framing, re-read rather than referenced, because y-websocket
does not export its envelope. It is deliberately a *recogniser*, not a parser —
it says whether bytes arrived in a shape the room will take, and nothing more.
The board's contents are Yjs's business. Its `decodeMessage` returns `null` for
what to ignore and `{ kind: 'invalid' }` for what deserves close code 1003, which
is why a truncated sync message is caught here rather than inside
`Y.readSyncMessage`, which swallows its own errors.

## workerd and toolchain facts worth not learning twice

- A Worker module may export **only** its Durable Object classes. A top-level
  `const` in `src/worker/index.ts` makes wrangler fail with "… is not a Durable
  Object" while naming an *unrelated* class — the export scan bails before it
  reaches the class. Constants belong in `src/shared/protocol.ts`.
- `src/worker` and `tests/integration` are excluded from `tsconfig.json` and
  typechecked by `tsconfig.worker.json` against `@cloudflare/workers-types`:
  workerd's globals (`WebSocket`, `WebSocketPair`, `DurableObject`) collide with
  the DOM's, and the client project would then fail to compile the room.
- Version set that actually resolves: `@cloudflare/vitest-pool-workers@0.12.21`
  nests `wrangler@4.72.0`, which wants `@cloudflare/workers-types@^4`, while
  `wrangler@4.145` wants `^5`. The root `wrangler` is pinned to `~4.72.0` so that
  one copy of `workers-types@^4` satisfies both.
- Vitest 3.2.7 resolves a pool with CJS `resolve.sync`, which cannot see a pool
  package whose `exports` map only exposes `require` — so
  `vitest.integration.config.ts` resolves the file itself and passes the path.
  And the workers project has to be referenced from `test.projects` *by file
  path*: an inline workers config dies in Vitest's own config normaliser.
- `isolatedStorage: false` in that project. Every test there leaves sockets open
  for its whole life, and per-test storage snapshots cannot unwind a socket still
  attached to an object from the previous test.
- The room does not hibernate yet (`server.accept` without a handler): with no
  persistence until story 4, a hibernated room would freeze the board in exactly
  the situation the PRD cares about (people editing while the object is cold). The
  socket bookkeeping is written so that adding hibernation is a handler, not a
  rewrite.

## What a connection's state means, and what it must not claim

`connectBoard` keeps the distinction the PRD turns on: a socket that is *open* is
not a board that is *agreed*. "Connected" is therefore only reported once the
first sync reply has been seen; `status: 'connected'` alone shows nothing, and a
dropped board is remembered (`dropped`) until it is genuinely agreed again —
otherwise a reconnect that syncs would be reported as a fresh failure.
BroadcastChannel is off always, not only in tests: two tabs of one browser
agreeing with each other without the room would make "did that come from the
other person?" unanswerable.

## Measuring a change arriving, and the three ways that went wrong

- A page records the *whole state* of each note it draws (id, position, colour,
  text — or gone) and keeps a **history** per note. "Has this note ever looked
  like this?" is the wrong question under editing, because a note is drawn in the
  same state again and again (a colour comes back, a note returns to where it
  was): the question is "when did this page next draw it like *this*?", which is
  `__sawAfter(id, key, notBefore)` — `notBefore` being when the change was made.
- A screen draws what the document looks like *after the whole batch of messages
  in flight has been applied*. An edit undone immediately is therefore never drawn
  by anybody, so the nightly soak drags a note, waits until every other screen has
  seen where it went, and only then puts it back (`Change.finish`).
- An edit that changes nothing measures nothing: painting a note the colour it
  already is, or dragging it nowhere, yields a state every other screen has
  already drawn. The soak picks a colour by how many times that note has been
  painted, and refuses a drag shorter than a few pixels.
- `createNoteAt` finds the new note by counting: fine for one person, wrong for
  five editing at once, where a page cannot predict how many notes there are about
  to be. The soak's `makeNote` recognises its own note by the words in it, in one
  pass of the page.

## Cutting a connection off, in a browser that will not do it

`browserContext.setOffline(true)` does not close an established WebSocket —
measured in Chromium and in WebKit, where the socket sits there open for the whole
window while `navigator.onLine` says false. TC-27 therefore drives the app's own
`window.__vidi6.emulateOutage(ms)`: the socket is closed, the reconnection address
is pointed at `ws://board.unreachable.invalid`, and after `ms` the address goes
back — three things a person's network does by itself, with only the length of the
outage invented. Port 9 on loopback was the first choice, and WebKit *throws* on a
reserved port, which arrives as a page error indistinguishable from a defect; a
name under a TLD no resolver will answer for fails quietly instead. Even so,
`Person.expectingOutage` scopes the tolerance: while a person is meant to be
unreachable, what their socket says about it is the outage, and from the moment the
board is agreed again it is a problem.

## Verification (story 3)

- `npm run test:unit` — 88 tests (TC-01, TC-02 board ids; TC-03 the framing)
- `npm run test:component` — 67 tests (TC-19, TC-20, TC-21 the badge; and the
  concurrent-typing editor, including a remote change landing mid-word and during
  an IME composition)
- `npm run test:integration` — 35 tests in workerd (TC-04…TC-06, TC-13, TC-17 at
  the route; TC-07…TC-18, TC-31 in the room)
- `npm run test:e2e` — 22 tests × (chromium, webkit), of which TC-22…TC-28 are
  this story's; TC-22 and TC-23 are the two the Done-when asks to see in both
- `npm run test:e2e:nightly` — TC-29 (idle 45 s, the socket never blinks) and
  TC-30 (a minute of editing by five people). Last run: 615 edits, 2 461 changes
  measured from one screen to another, p50 49 ms, p95 270 ms, max 360 ms against a
  1 000 ms budget that is reported and never asserted.
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass.

## `npm run dev` in this sandbox

Not a story-3 fact, but a trap: in this sandbox the app does not boot under
`vite` at all — `@vitejs/plugin-react` hands `.tsx` files to Babel, Babel stats
upward for a `package.json` boundary, the sandbox refuses reads outside the
workspace, and `/src/client/main.tsx` comes back 500 with an empty `#root`. It is
nothing to do with the room, and it is why every e2e here runs against the
*built* client served by `wrangler dev`. What could be checked about the dev
proxy was checked at the transport level: through `vite`, a
`GET /api/rooms/<22-character id>` answers 426 and a shorter one answers 400, both
from the Worker, and a WebSocket upgrade to `/api/rooms/<id>` opens and is answered
by the room.

## Firefox does not start in this sandbox

TC-22 and TC-23 are asked for in firefox as well as chromium and webkit. They pass
in chromium and webkit; in firefox they cannot be run here at all. The browser is
installed (`firefox-1543`) and Playwright launches it, but Firefox's own macOS
sandbox refuses to initialise — `sandbox_init() failed with error "Operation not
permitted"`, with Firefox asking to read `/private/etc/localtime` and to look up
`com.apple.coreservices.launchservicesd`, both outside this workspace — and with
`MOZ_DISABLE_CONTENT_SANDBOX`/`MOZ_DISABLE_GPU_SANDBOX`/`MOZ_DISABLE_SOCKET_PROCESS`
set, the launch does not even get that far: it hangs until the test times out. It
fails inside `browser.newPage()`, before any of this app's code runs, which is why
story 1 and story 2 also verified in chromium and webkit only. Whoever runs this
next should run `npm run test:firefox` outside the sandbox for those two cases; the
assertions are the same ones that pass in the other two engines, including the
`expectNoProblems` guard that would catch a browser objecting to the outage.

---

# Story 8 — undo and redo my own changes, nobody else's

Everything the design asked for is there: `createUndo(doc, opts)` over
`Y.UndoManager` in `src/client/board/undo.ts`, the React binding in
`useUndo.ts`, the two buttons in `UndoButtons.tsx` in the left `Toolbar`, the
shortcuts in `useBoardKeys`, gesture and edit boundaries through story 7's
`onGestureStart`/`onGestureEnd` and `StickyTextEditor`, and the two named
settings in `src/shared/config.ts`. TC-01 to TC-21 and e2e TC-22 to TC-24 pass;
`npm run build` builds.

Three things turned out differently from the design's letter. Each is a
deviation I made on purpose, and each is recorded here with its reason.

**The controller is created in `Board.tsx`, not `App.tsx`.** The design names
`App.tsx` as the tab that makes the controller, but in this codebase `App.tsx`
is only the router — it renders `HomePage`, `BoardPage` and `NotFoundPage` and
never sees a `Y.Doc`. The document is made by `useBoardDoc`, one board deeper,
and `Board.tsx` is where it, the selection state and the edit lock all come
together. `useUndoController(doc)` in `Board.tsx` is therefore the one owner,
and it is still exactly one controller per tab per board.

**A controller's lifetime is held in a `Holder`, because of StrictMode.** The
first attempt was the obvious `useMemo` / ref + cleanup pattern. It is wrong:
React's development StrictMode mounts the tree, unmounts it, and mounts it
*again*, and in React 19 that second mount re-runs neither `useState`
initialisers nor — in the ref pattern — anything that recreates the controller.
The result was a mounted board holding a controller whose `destroy()` had
already run, whose `manager.destroy()` had thrown its stacks away, and which
therefore had no history at all: the first `Ctrl+Z` did nothing. The holder is
a state cell with an `alive` flag: cleanup flips the flag and destroys; the
re-mounting effect sees a dead holder, makes a fresh controller and forces one
render to say so. In a production build there is no double mount, the effect's
`if` never fires, and the controller is destroyed exactly once. `undo.session_only`
is what makes this correct at all: a controller is not meant to survive its mount.

**`UNDO_CAPTURE_TIMEOUT_MS` cannot be measured with fake timers.** TC-12 and
TC-13 are "vi fake timers, keystroke gaps below/above UNDO_CAPTURE_TIMEOUT_MS".
That is not testable that way, and not for want of trying: `yjs` does not call
`Date.now()` at the moment it measures a pause — it calls `lib0/time`'s
`getUnixTime`, and `lib0` defines it as `export const getUnixTime = Date.now`,
capturing the function once at module load. `vi.useFakeTimers()` and
`vi.setSystemTime()` replace the method on `Date`, so `Date.now()` moves while
`getUnixTime()` does not — every transaction looks instantaneous to the capture
window, which therefore never ends. Both tests use real waits instead, and the
threshold is still tested to the millisecond, via `captureTimeoutMs: 200`:
220 ms of quiet makes two steps, 380 ms of typing in 60 ms gaps makes one.
TC-13's two sides are also two *notes*, because two pieces of text written into
one `Y.Text` are merged by yjs's own structural rules (`undoType`s merge) no
matter how far apart in time they are — the boundary is what separates them, and
that belongs to `undo.boundaries`, not to the capture timeout.

Two things worth knowing about `Y.UndoManager` itself, learned by reading it in
`node_modules/yjs/dist/yjs.cjs` and by probes:

- **A step with nothing to undo is consumed silently** — and, depending on how
  far the deleted struct has been garbage-collected, it may be *kept* instead.
  `popStackItem` walks `trans.items`, skipping anything another client has
  deleted; when nothing is left it returns `null`, and when the leftovers are
  structs whose `fromDiff` is zero it breaks and leaves the item on the stack.
  Either way nothing is applied and nothing throws, which is what `undo.safe`
  needs; but it means "one press of Undo ⇒ exactly one step off the stack" is
  not a promise yjs gives. So e2e TC-23 asserts what the PRD asks and not more:
  the undo of a move of a note a colleague has deleted gives no error, invents
  no note, and the *next* undo works. It does not assert the button's disabled
  state, which is not in the PRD and which is exactly the part yjs may answer
  either way. The unit tests (TC-07) test the same safety in the deterministic
  case, where the stack really is empty afterwards.

- **`manager.destroy()` does not unsubscribe the manager from the document.**
  It drops its stacks, its observers and its capture timeout, but the
  `transaciton` event handler it added to `doc` stays. `UndoController.destroy()`
  calls `doc.off('transaction', manager.skippedHandler)` itself, so a board that
  is closed, reloaded or exchanged leaves no observer behind. `manager.skippedEdit`
  (the method reference React never sees) is kept as `skippedHandler` for that
  purpose — and it is also the reason `useUndo`'s actions must not be treated as
  no-ops: `undo()` calls `manager.undo()` directly rather than going through an
  editor-style `skipNextHandlerCall`, which would leave the controller silently
  ignoring the next local write in some other component.

One more thing that only showed up in the browser: **`UndoManager` trims nothing
by itself**, so `UNDO_MAX_STEPS` is enforced by the controller (TC-09, TC-10 —
undo stack only, redo stack untouched), and **a chain of model-level `createSticky`
calls inside one capture window is one step**: the design's own "create is one
step" boundary comes from `boundary()` around the model call and from
`selection.startEdit` opening an edit session (which calls `boundary()` again),
so the e2e creates notes through the UI and the component tests, which call the
model directly, expect one merged step for two creates.

Finally, `NoteToolbar`'s colour and delete got their own `boundary()` pair — the
design names them, and without them three swatches clicked one after another are
a single undo step instead of three. The extra component test ("every colour
chosen in a row is a step of its own") is what caught that: it fails when the
boundaries are taken back out.

---

# Story 10 — Draw shapes and connect them with arrows that follow when moved

The document model, the geometry, the two tools and the two components are as the
design draws them: attached endpoints that store no side, sides recomputed from
live rectangles on every read, `detachConnectorsTo` inside `deleteObjects`' own
transaction, and a Connector tool whose dots and highlight are DOM. Six things
came out differently from the design's letter, and all six are recorded here with
their reasons.

## The fallback beside a fastened end is the side the end is drawn on, not the side the pointer was nearest

The design says an attached end "is drawn at the midpoint of the side of its
object nearest the other end … that anchor is also stored as `fallback`", and the
first implementation stored instead the anchor of the side nearest *the point the
pointer was released at*. Those are the same anchor when the arrow is drawn but
not when the arrow is long: the release point is on the far shape, and the side of
that shape nearest a pointer standing at its top-left can be a side the other end,
across the board, does not face. The end was drawn on one side and buried with the
anchor of another, so the moment the shape went away — `connector.target_deleted`,
the race the fallback exists for — the end jumped to where it had been stored.
E2E TC-27 measures exactly that jump: 90 board units between where Dana's arrow was
drawn and where the same arrow landed after Sam's delete arrived. `endOf` now takes
the aim of the other end (the middle of the object it is fastened to, or the point
it is free at) and stores `sideAnchor(rect, nearestSide(rect, aim))`, which is the
same expression `resolveConnectorEnds` draws with: an end orphaned by a delete is
left exactly where it was last drawn, and both screens agree on where that was
without being told.

## `detachConnectorsTo` releases the side the arrow is touching, not the side it was stored with

Same rule, on the delete side. An end says "A" with a fallback from the day it was
drawn; if B has since been dragged under A, the end is drawn on A's bottom face
while its stored fallback names the right one. Releasing at the stored fallback
would move the arrow at the moment of the delete. The release point is
`endpointAnchor(end, rects, aimOf(other, rects))` — where it is drawn, computed
while the object is still in the transaction to be deleted, and only ends whose
object is in the deleted set are touched at all (`detachConnectorsTo` returns the
arrow ids it freed, which is what `deleteObjects` keeps for the undo bookkeeping).
`tests/unit/connector-model.test.ts` ("releases the side the arrow was actually
touching") moves B below A first, deletes A, and expects the end at A's bottom
anchor — it fails against the stored-fallback version.

## An arrow is dragged by where its free ends are, not by how far it has gone

`moveObjects` takes nothing of a connector any more: an arrow has no position of
its own to add a drag's distance to — its stored box is the box its ends happen to
draw, and an attached end belongs to somebody else's shape. The first attempt let a
drag of the arrow translate its free ends by *the delta since the drag began*, on
every frame; because the box the frame was measured against is never rewritten (a
connector's box is derived on read), the deltas accumulated instead of converging,
and a 60-pixel drag at 50 % ended 540 board units away — 4.5 times the pointer's
travel, at both 50 % and 200 %, found by E2E TC-28 and not by any component test,
because the component tests each drag once. The model's answer is
`setConnectorFreeEnds(doc, positions)`: the drag says where the free ends have got
to, in board units, and writing the same points again moves nothing (a frame that
changes nothing writes no transaction and costs no undo step — tested to the
document-update count). Attached ends in the same call are refused: dragging an
arrow does not drag the shapes it joins. The arrow-key nudge (`useBoardKeys`) and
the group drag (`useTransformGesture`) both carry an `ends` map of resolved ends
beside their positions map, so an arrow selected with shapes still follows its own
rule; one `boundary()` on each side keeps each press or drag one undo step.

## The world layer is `pointer-events: none`, so every object has to opt back in

`.shape-object` was missing `pointer-events: auto`. In jsdom that is invisible —
component tests dispatch events at nodes directly — and in Chromium and WebKit it
means the shape is not there as far as the mouse is concerned: the first E2E run
could draw a shape, could not click it, and reported it as a selection bug. Every
object element in the world layer must set it; `.sticky-note` and `.text-object`
already did, and the story 10 stylesheet carries it for `.shape-object` and
`.connector-object` (the connector's SVG spans the bbox, so the hit test decides
what is a hit rather than the element's outline).

## The race is forced with the product's own outage, not with a route delay

The design's test seam says "Timing of concurrent delete: Playwright route delay on
Sam's socket traffic". A route delay can hold up messages that have not been sent
yet; it cannot hold up frames already handed to an open WebSocket, and the whole
race is a few milliseconds wide — far too narrow to land a delete inside by waiting.
TC-27 overlaps the operations the way the product is specified to behave when it
cannot see the room: Dana loses the board through `__vidi6.emulateOutage`, and while
it is lost nothing Dana does can reach the room and nothing the room does can reach
Dana — an operation overlapping a delete, held open for as long as anybody wants to
look. TC-27 then waits through both halves: release-first (the arrow is created
attached to a shape Dana still sees), and the arrival of Sam's delete (the end stops
being attached to something that no longer exists, on both screens, at the same
point). A 4-second outage does not do it — the socket reconnects before the badge
ever says 'Reconnecting…'; the test uses the product-scaled `CATCH_UP_TEST_OUTAGE_MS`
that story 4's catch-up tests already use.

## Test seams on the connector element, and what each uniquely says

`ConnectorObject` carries `data-from-x/y/kind`, `data-to-x/y/kind` and
`data-detached`. The kinds are the **drawn** kind, not the stored one:
`endIsAttached(end, ids)` says whether an end is stuck to a shape the board has,
which is what a screen shows. A locally deleted shape leaves `data-detached='false'`
and `kind='free'` — `deleteObjects` freed that end inside its own transaction — and
only an end that arrives stored-attached to a missing id (a remote delete, the
race) says `data-detached='true'` while drawing as a point in the air. That
combination is the only state that looks stranded, which is why TC-27 asserts the
pair together and TC-26 asserts the other.

## Smaller deviations, each with its reason

- `endOf` is exported from `useConnectorTool.ts` and shared with
  `useConnectorEndDrag.ts`, so a re-attached end gets the same fallback rule as an
  end drawn in the first place; the same-shape drag and the too-short drag are
  rejected in the tool as well as in the model, because they are statements about
  the drag, and the tool must not leave its undo window open to find out.
- `useActiveTool.ts` is a thin re-export of story 9's `useTool` extended with
  `'shape' | 'connector'`, `TOOL_SHORTCUTS` (`S`, `L`) and `shapeKind`, exactly as
  the design's "created here if no earlier story has added it" branch allows. The
  design's full `ToolId` (`pen`, `image`, `comment`) is not added: those stories are
  out of scope here, and a union that names tools no code can activate only makes
  the switch in `Board.tsx` non-exhaustive-looking for nothing.
- `hitTest` in the registry grew an optional third argument, `zoom`: the design's
  connector entry needs `distanceToPolyline ≤ 6 px / zoom`, and story 7's signature
  passed only the world point. Optional, so every existing entry is unchanged.
- The label is an HTML `div` centred over the SVG, not a `<foreignObject>`: a
  textarea inside `foreignObject` loses caret placement under Safari at zoom ≠ 1,
  and the plain overlay reuses story 9's `TextEditor` verbatim — which took three
  optional props (`maxChars`, `objectSelector`, `testId`) so that the 500-character
  clamp and the test seam could come without touching how text objects behave.
- The arrowhead is a `<polygon>` computed from the line's direction rather than an
  SVG `<marker>`: markers scale with `stroke-width` in ways that change the head's
  size with the zoom, and `CONNECTOR_ARROWHEAD_SIZE_WORLD` is meant to be a size in
  board units.
- `setConnectorEndpoint` validates the `end` argument itself (`'from' | 'to'`), so a
  wrong end answers `false` and writes nothing rather than writing a key no read
  looks at.
- `CONNECTOR_MIN_LENGTH_WORLD` is compared against the length of the **resolved**
  ends (the design says "resolved length"), which is why TC-09's 7.9/8 boundary is
  tested against shapes whose anchors are 300 apart minus two side insets.

## Test seams

- `tests/fixtures/checkout-flow.ts` builds the design's fixture with real model
  calls: rect, diamond, ellipse, rect — four labelled shapes, three attached
  connectors, one free-ended. `tests/component/CheckoutFlow.test.tsx` drags one
  shape and asserts every arrow lands on the side its shape now faces, and deletes
  one and asserts the arrow stays at the former anchor as a free end.
- E2E asserts sides through an `arrowSides(page, id, leftId, rightId)` helper that
  answers `'right|left'`/`'attached|free'`-style strings, so a side regression names
  the side that went wrong. Component tests read the camera back from the world
  layer's transform string (jsdom has no computed transform) and change zoom with
  the same `__vidi6.setCamera` hook the product builds in test mode.
- `tests/e2e/helpers/shapes.ts` keeps the geometry assertions in board or screen
  space (`drawShape`, `drawArrow`, `arrowState`, `shapeCentre`, `sideFacing`,
  `expectArrowEndAt`), all of them polling, because a remote move is on the wall
  clock and not on the event loop.

## Verification (story 10)

- `npm run test:unit` — 298 tests, of which `tests/unit/shape-model.test.ts` is
  TC-01…TC-06 and `tests/unit/connector-model.test.ts` is TC-07…TC-14, TC-29 and
  the `setConnectorFreeEnds` drag rule.
- `npm run test:component` — 205 tests, of which `ShapeAndConnector.test.tsx` is
  TC-15…TC-22 and TC-28 and `CheckoutFlow.test.tsx` is the fixture's follow/delete.
- `npm run test:integration` — 94 tests, unchanged: this story writes no server
  code, and the sync path it rides on is proven in story 3.
- `npm run test:e2e` — `shapes-and-connectors.spec.ts` is TC-23…TC-28; the whole
  chromium suite (58 tests) passes, TC-27 also passes in webkit, and the
  persistence suite still passes. Firefox is not run here for the reason story 3
  records (`sandbox_init()` refuses in this sandbox); the assertions are the ones
  that pass in the other two engines.
- `npm run typecheck`, `npm run build`, `npm run build:test` all pass.

# Story 11 — Sketch freehand with a pen

The stroke model, the RDP simplifier, the Pen tool and the stroke component are as
the design draws them: local points during a drag and one transaction at the end,
`getCoalescedEvents()` read when the browser offers it, a screen-space preview that
never reaches the document, a smoothed quadratic path shared by the preview and the
saved drawing, `scaledPoints` for a hit test and a resize that keep a drawing's pen,
and one undo step per drawing. Eight things came out differently from the design's
letter, and all eight are recorded here with their reasons.

## Whether a press is a dot is measured by the road travelled, not the distance home

The design says a stroke whose "movement is below `DRAG_THRESHOLD_PX`" is a dot, and
the first implementation read `hypot(last.x - first.x, last.y - first.y)` — the
straight line from where the pen went down to where it came up. That is the whole of a
circle's diameter and none of its circumference: a person who draws a ring round
something brings the pen back almost to where it started, and a tool that measured the
straight line home drew every circle as a dot. `Stroke` now carries `travel`, the
running sum of the distances between successive pointer samples, and the dot test is
`travel < DRAG_THRESHOLD_PX`. A closed loop of four hundred points is a loop; a press
that never moved is still a dot, because a pen that did not move has no road to have
travelled. `tests/component/PenTool.test.tsx` keeps the regression test that draws a
closing square and expects the drawing to be a square and not a point.

## The pen is chosen when the pointer goes down, and the preview is drawn with that pen

The design reads the colour and thickness when a stroke is finished. What is on the
screen while the stroke is in flight is drawn with the pen chosen at the moment the
pointer went down, and it is that same pen that is saved — a swatch pressed halfway
across a drag belongs to the next line, the way a pen with a swappable refill belongs
to the next line rather than this one. The reason the preview is the load-bearing part
of this: `PenPreview` is handed `previewPen` from the hook and not the live
`pen.color`, because a preview that recoloured halfway across the board would be a
preview that lied about the stroke it was promising. E2E TC-18 draws a black stroke
and a red one and expects the watcher to see two different pens on the board, not one
board that changed colour.

## A drawing's colour is an attribute on the painted path, never a CSS rule

`.stroke-line` deliberately declares neither `stroke` nor `stroke-width`. A CSS rule
that named them would be a rule that repaints every drawing on the board the moment a
person picks a different colour from the toolbar — a colour chosen for the next stroke
would silently recolour the ones already saved. The pen each drawing was drawn with is
stored on the drawing (`data-color`, `data-thickness`) and painted from it. Selection
is likewise not a restyling: a selected drawing is given `filter: drop-shadow(...)` so
the highlight goes over the drawing rather than into it.

## The drawing does not offer its box to the pointer; it offers its line, at a distance

`stroke.object` is asked to hit-test with `distanceToPolyline(scaledPoints(s), p) <=
max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom)` so that a click inside a drawing's
bounding box but away from its line falls through to whatever the drawing is drawn
over — and the component that makes that true on the screen is two paths, not one. The
painted path is `pointer-events: none`; a second, invisible path paints the same line
at `STROKE_HIT_TOLERANCE_PX * 2 / zoom` with `pointer-events: stroke`; the wrapper is
`pointer-events: none`. So a click in the middle of a ring drawn round a sticky note
misses both the ring and its own box and lands on the note, which is what E2E TC-20
and component TC-16 assert. The corridor at a low zoom is wider than the box it is
drawn in, which is why `StrokeObject` adds an `OVERFLOW` of 8 board units to the
wrapper and shifts the `viewBox` by the same — a corridor clipped to the box would be
a corridor that stops working when the board is zoomed out. E2E measures both the
painted corridor and the painted line through the path's own `getScreenCTM()` and
expects the corridor to hold at twelve screen pixels at 100 % and at 200 % while the
line doubles: this is the story 9 lesson, drawn with a pen.

## The tool owns its drag on the window, so the viewport never had to be told about the pen

The design asks for a `BoardViewport` change to route a pen `pointerdown` away from
panning and object drags. The tool does it the way the other two drawing tools already
do the same thing — a window listener in the capturing phase that calls
`stopPropagation()` on every event it is acting on — and `BoardViewport.tsx` is
unchanged. This is also the whole of the two navigation rules at once: the board never
pans under a pen drag and no note under the pointer moves, because the viewport and the
note never see the press. And because a wheel and a pinch are not pointer events,
scroll-to-pan and Ctrl/Cmd-scroll-to-zoom go on working with the pen in hand exactly as
story 1 left them, which TC-19 checks by panning the board with the Pen tool active and
reading the camera back. A press that begins on a toolbar or in a box being typed into
is not a stroke: the press on a colour swatch that chose a colour would otherwise draw
a dot in that colour on the board first, and TC-17 asserts that choosing a pen leaves
the drawing count alone.

## Leaving the pen by choice drops the stroke; having the pointer taken away keeps it

Two endings that the design puts together and that behave apart. `pointerup` and
`lostpointercapture` both finish the stroke and save it — a pointer taken to another
window mid-line is not a person who asked to lose what they had drawn. `pointercancel`
finishes it too. But leaving the tool — Escape, V, another shortcut, a click on the
toolbar — is the cleanup of the effect that armed the listeners, and that drops the
points in flight and draws nothing: a stroke left half-drawn is a stroke that was not
finished, and the pen does not finish things by accident. TC-13 (component) presses
Escape mid-drag and asserts, as the negative, that nothing was created.

## The point limit is met by finishing a drawing and beginning the next, not by stopping

At `STROKE_MAX_POINTS` the tool does not stop recording; it simplifies and saves the
part it has, then restarts the points from that part's last point, so a stroke of a
hundred thousand points is a run of drawings whose ends meet on the board with no gap.
TC-12 (component) feeds `STROKE_MAX_POINTS + 10` moves and expects two committed
drawings whose shared point is the same point.

## A drawing is stored in a box padded by its own pen, and its points are read back in board units

`scaledPoints` returns board coordinates — a saved point put back through the box the
drawing has been resized into — so the design's `hitTest(obj, worldPoint, zoom)` works
on it directly, and the resize handles of story 7 honour it by scaling the box and
nothing else. The box is padded by `thickness / 2` on each side so a single-point dot
has a box of its pen's diameter and not a box of nothing. The `L` at the end of
`smoothPath` is straight rather than a curve so that a drawing finishes exactly where
the pointer came up; it also makes the number of coordinates in a path `4n - 4`, which
is what the unit tests count.

## The e2e helpers read the drawing's own report of itself, and a `d` measured in the page

A drawing's box is read from `data-box-*` (board units, the way an arrow reports its
two ends), and a point on its line from `getPointAtLength` on the painted path, because
the middle of a drawing's box is the middle of nothing and clicking it would be a test
that clicked where the drawing is not. The point used to be taken with
`getScreenCTM().transformPoint(...)`, which is not dependable across every engine this
suite runs in; the six numbers of the matrix are applied by hand instead. Two gestures
needed care to be the gestures they claim to be: the preview is sampled by the page
once per `requestAnimationFrame` while the pointer moves — a test that polled from node
would be measuring how fast a socket is — and the "drag the body to move it" gesture
grabs the line a quarter of the way along it and asserts it is clear of every resize
handle first, because the middle of a nearly-straight drawing is where the top and
bottom handles are, and a test that grabbed a handle resized the drawing and called it
a move.

## Verification (story 11)

- `npm run test:unit` — 331 tests, of which `tests/unit/stroke.test.ts` is
  TC-01…TC-08 (simplify, split, smooth path, `createStroke`, `scaledPoints`, the
  hit-test distance, the box, the malformed input).
- `npm run test:component` — 244 tests, of which `PenTool.test.tsx` is TC-09…TC-14
  with the undo and remote-stroke cases and the closed-loop regression, and
  `StrokeObject.test.tsx` is TC-15, TC-16 and TC-21 with the corridor width, the
  registry contract and shift+click.
- `npm run test:integration` — 94 tests, unchanged: this story writes no server code,
  and the sync path it rides on is proven in story 3.
- `npm run test:e2e` — `freehand-sketching.spec.ts` is TC-17…TC-20. The story's five
  tests pass in chromium and in webkit; the whole chromium suite (62 tests) passes and
  the persistence suite still passes. Firefox is not run here for the reason stories 3
  and 10 record (`sandbox_init()` refuses with "Operation not permitted" in this
  sandbox); TC-17's assertions are the ones that pass in the other two engines.
- `npm run typecheck` (both projects), `npm run build`, `npm run build:test` all pass.
  There is no lint script in this repository and no `eslint.config.js`.

# Story 12 — Drop images onto the board

The picture is one more object type and the design is right that that is all it is:
selection, moving, resizing with the shape kept, deleting, undo and the remote-update
path are the ones already there, and the new code is a schema, a placement function, an
upload, three ways in and one component that says what a picture whose bytes have not
arrived yet is. Nine things are recorded below: three decisions the design left to the
implementer, three places where following its letter closely would have produced
something wrong, a function from story 7 that was wrong in a way nothing had been able to
see, a mistake of this story's own that only a real browser could see, and one keystroke
that had to be told the difference between a shortcut and a letter.

## An image's box is written before its bytes exist, and the upload is not an undo step

`createImagePlaceholders` writes `status: 'uploading'` objects in one transaction with
`LOCAL_ORIGIN`, so a drop is one undo step and undoing it takes the picture off the board
for everybody. What happens to those bytes afterwards is *not* an undo step: marking a
picture ready, failed or retried goes in with `UPLOAD_ORIGIN`, a symbol of its own.
`LOCAL_ORIGIN` would have made every finished upload a step in the uploader's history —
Ctrl+Z after a photo would remove the photo, which is not what anybody means by undo —
and `undefined` (a remote change) would have put it in *everybody's* history. A change
that is this tab's and nobody's to undo needs a third kind of origin, and that is what
the symbol is. `src/shared/objects/image.ts` names it and says why next to it.

## The status a picture shows is not the status it stores

`displayStatus(object, isMine, now)` is a function rather than a field, because three of
the six things on the screen are facts about *this tab* (am I the one holding the file?)
or about *now* (`unfinished`: still `uploading` after `IMAGE_UPLOAD_STALE_MS`, which is
what a browser tab that was closed mid-upload leaves behind). A document that stored the
display state would store a lie the moment somebody else's screen disagreed. The single
`canRetry` prop on `ImageObject` is the whole of the difference between the two viewers:
the tab with the file gets "Upload failed" with Retry and Remove, and every other screen
— including the uploader's own tab after a reload, which has lost the `File` along with
everything else — gets "Image unavailable" or "Image upload didn't finish" with Remove
alone. Handing a Retry button to a tab that has no file would be a button that cannot
do the thing it says.

## The rule for the refusal boxes: everyone may take it away, only the owner may try again

Every box that says a picture is not there offers Remove, including a `ready` object
whose bytes have gone missing from the bucket and a failure made by somebody else. The
reason is that taking a thing off the board never depends on having that thing: it is a
change to the document, and a person who is looking at a broken picture is entitled to
tidy it up whether or not their computer ever had it. Retry is the opposite case: it
fetches bytes out of this tab's memory. That split is why the two buttons are not one
button and why the e2e asserts that the person who did not drop the picture is shown a
Remove and no Retry.

## A picture's box is not clipped, and takes the pointer back

`.image-object` is `pointer-events: auto` like every other object — the world layer
ignores the pointer and each object type opts back in — and it deliberately does *not*
have `overflow: hidden`. The picture itself cannot leave its box (`object-fit: contain`,
sized to it), and the one thing that has to hang over the edge of a small picture is the
sentence about its bytes and the buttons under that sentence: a 40-pixel thumbnail whose
"Retry" is cut off is a failure the person cannot act on. So `.image-uploading`,
`.image-status` and `.image-broken` are centred on the picture's box with
`width: max(100%, 148px)`, which is the picture's own box at the picture's size and
larger only when the box is too small to hold a sentence. Nothing about the object's box
moves: it stays what the selection and the resize handles act on.

## `clampScale` was wrong, and the resize floor could not be tested until it was fixed

A resize keeps one object's shape, so one number has to keep both of its sides inside
`[minSize, maxSize]`: every object contributes a floor (the smallest scale that leaves
*both* its sides at or above the minimum, which is the *larger* of the two per-axis
floors) and a ceiling (the largest that leaves both at or below the maximum, the smaller
of the two). The old code clamped a width-derived scale and a height-derived scale
separately and then took `Math.min(clampedX, clampedY)` for both axes — which is the
*tighter* of the two ceilings, correct when growing, and the *smaller* of the two floors,
which is not a floor at all. A 40x30 picture with a 16-unit minimum has floors of
16/40 = 0.4 and 16/30 = 0.53; the smaller won, so the picture could be dragged down to
16x12 — its width exactly at the minimum and its height four units under it, a minimum
the PRD names in words ("SHALL NOT make either side smaller than 16 board units") that
nothing was checking. The shape was never the problem; the floor was. It is now a
floor/ceiling interval intersection over both axes of every object in the resize, so an
image's aspect lock and `IMAGE_MIN_SIZE_WORLD` hold at the same time. E2E drags a 40x30
picture's corner far past the floor and reads back a box with both sides at or above the
minimum and the ratio still 4:3, and `image-model.test.ts` pins the interval itself —
story 7's three tests of this function all use squares, where the two floors are the same
number and the mistake has nowhere to show.

## The class list was run together, and only a browser could see it

`ImageObject` built its `className` with `['image-object', `image-object-${status}`,
' is-mine', …].join('')` — the leading spaces on the later names made it *look*
considered. It produced `image-objectimage-object-failed`, which matches no rule: in a
real browser a picture was `position: static`, so every picture was laid out in the flow
at the world origin wearing its inline width and height, `pointer-events` inherited
`none` from the world layer so it could not be clicked, and its buttons were outside the
hit box. Every component test passed, because jsdom loads no stylesheet: a class
attribute is a string to it, and a run-together class measures nothing and fails nothing.
It came out as a story 6 test (`text.spec.ts` TC-30) failing under webkit, which is how
worthless a green component suite can be made visible. The join is now `join(' ')` over
filtered names, and `ImageObject.test.tsx` asserts the names are *separate* class names —
the cheapest possible guard for the one class of mistake that this tier cannot otherwise
see.

## The letter 'i', and the moment before the caret lands

'i' opens the file dialogue, which is the sharpest thing a stray keystroke can do: it
takes the person out of the page and eats the letter besides. `isTypingTarget(e.target)`
already covers the case where the caret is in an editor. It does not cover the moment
between a click that opens a text object and the caret arriving in it, when the letters
of the word a person is typing arrive at the window. Measured on webkit with
`--repeat-each=12`: the story 6 test that has five people type "Heading n" — a word with
both 'i' and 'n' in it — failed 2 of 12 runs *before this story existed*, and 2 of 12
with the 'i' binding and no guard, and the instrumented version showed a real file
dialogue opening in the failing page. `useTool` now asks `isWritingText()` (the board's
`selection.editingId`, read at the key press) before honouring 'i', and with that
12 of 12 pass. 'n' is left exactly as story 8 specifies it, including its own test that
asks for N out of the Text tool; the same guard is one line away in `useTool` if a later
story wants to take the sharper question up.

## Refusals that say the same thing are said once

The toast store keys on the text, so dropping a PDF and an SVG — refused by the same
sentence naming the four formats — leaves one toast on the screen, not two. That is the
behaviour a person wants and it cost an e2e assertion written as "two refusals"; the
test now asserts the count stays at one and that neither file left an object behind,
which is the thing the story is actually about.

## A progress bar that is honest about being about bytes

`fetch` reports no upload progress, so `uploadImage` uses `XMLHttpRequest` for that and
nothing else. The fraction is the browser's count of bytes sent, which reaches 1 well
before the board has stored the picture; the picture's *state* stays the object's
`status`, and the bar is only ever painted as a percentage of the upload. Progress
arrives as `onProgress` into a ref and is read by the component, so a fast connection
does not re-render React per packet.

## Verification (story 12)

- `npm run test:unit` — 407 tests, of which `tests/unit/image-format.test.ts` is TC-01 and
  TC-02 (sniffing the four formats out of bytes, the key pattern, a key's board id),
  `image-model.test.ts` is TC-03…TC-07 (placement sizes, rows, the status machine, the
  stale upload, malformed objects, and the resize interval an aspect-locked picture needs)
  and `image-validate.test.ts` is TC-08 and TC-09 (type, size, count, order of the three
  refusals). 76 of them are new.
- `npm run test:component` — 297 tests, of which `ImageInsert.test.tsx` is TC-17…TC-19 and
  TC-24 plus the offline and 'i'-key cases (34) and `ImageObject.test.tsx` is TC-21…TC-24
  with the two viewers, the reload and the class names (19).
- `npm run test:integration` — 121 tests, of which `image-assets.test.ts` is TC-10…TC-16
  (27): upload and round trip against the real R2 binding from `wrangler.jsonc`, the type
  asked of the bytes and never of the filename, 413 by declaration *and* by measurement,
  415 for a PDF and an SVG, 404 for an unknown or malformed board id and for a key with a
  way out of it, the serve headers, and a bucket that throws answered as 500 rather than
  as a bad file.
- `npm run test:e2e` — 142 tests pass across chromium, webkit and persistence.
  `tests/e2e/images.spec.ts` is TC-25…TC-28 in six tests: four formats dropped and
  painted on both screens with one address per picture, the board reloaded keeping its
  pictures and not asking for an upload it lost, a corner drag that keeps the ratio and
  stops at the smallest box (with undo), an upload that fails and comes back when its
  button is pressed, both doors refused while the room is down, and a file that is not one
  of the four formats refused with the formats named.
- Two pre-existing flakes were measured rather than assumed, because both showed up while
  this story's work was in the tree and neither is caused by it: `undo.spec.ts` TC-22
  failed 2 of 4 chromium runs **at HEAD with this story stashed** (1 of 4 with it), and
  `text.spec.ts` TC-30 failed 2 of 12 webkit runs at HEAD. Firefox is not run here, for
  the reason stories 3, 10 and 11 record (`sandbox_init()` refuses with "Operation not
  permitted" in this sandbox).
- `npm run typecheck` (both projects), `npm run build`, `npm run build:test` all pass.
  There is no lint script in this repository and no `eslint.config.js`.
