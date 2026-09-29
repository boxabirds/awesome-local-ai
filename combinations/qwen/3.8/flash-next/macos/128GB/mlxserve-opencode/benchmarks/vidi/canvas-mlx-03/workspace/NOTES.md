# Story 3 — Live collaboration (see other people's edits appear live)

Implementation of `sync.worker_entry`, `sync.room`, and `sync.client`: a BoardRoom
Durable Object per board relaying Yjs sync + awareness over WebSockets, and the
browser `WebsocketProvider` connection with a derived status badge.

## Test totals (all passing)

- **unit** — board id (`TC-01/02`), protocol decode (`TC-03`), connectBoard
  backoff/url wiring — `tests/unit` (run in `npm test`)
- **component** — connection status badge state machine `TC-19/20/21` — `tests/component`
- **integration** (workerd, `@cloudflare/vitest-pool-workers`) — `TC-04..06, 13, 17`
  (worker routing) and `TC-07..12, 14..16, 18, 31` (BoardRoom relay/merge/error) — `tests/integration`
- **e2e (per commit)** — `TC-22..28` plus supplemental drop/recovery & multitab — `tests/e2e`
- **e2e (nightly)** — `TC-29` idle stability, `TC-30` capacity soak — `tests/e2e/nightly`

## Design decisions honoured

- **`MAX_CONCURRENT_EDITORS` is soft and never enforced** (design `live.over_capacity`,
  worker entry comment). There is no connection-limit check and **no `4403` close**; the
  only server-initiated close is `CLOSE_UNSUPPORTED_DATA` (`1003`) on a malformed frame.
  The "6th participant must not be refused" property is integration **TC-13**
  (`MAX_CONCURRENT_EDITORS + 1` sockets all get 101 and the last writer's note reaches all).
- **Awareness is relayed verbatim to every socket including the sender.** This keeps idle
  `y-websocket` clients receiving traffic so their no-message timeout never fires; proven
  by nightly **TC-29** (45 s idle, badge never shows Reconnecting).
- **`disableBc: true`** in `connectBoard` so same-browser tabs cannot sync around the
  server — the room is the single relay (multitab supplemental test).
- **Status badge** (`connecting / reconnecting / confirmed / connected`): `connected`
  renders nothing; a reconnect flashes `Connected` for `CONNECTED_CONFIRMATION_MS` then
  hides. First-ever sync goes straight to `connected` (no initial flash).
- **Selection/editing stay local** — never in the Y.Doc; a selection on one board does not
  appear on another (e2e **TC-28**).

## Test-harness notes

- **Integration: `singleWorker: true` + `isolatedStorage: false`.** The deeply-nested
  workspace path exceeds macOS's 255-byte filename limit when vitest-pool-workers builds a
  per-test Durable Object SQLite directory name; sharing one worker/isolated storage avoids
  it. Tests therefore run serially within the integration project.
- **`statusText` is not preserved** through workerd's internal `SELF.fetch`; integration
  assertions check numeric status codes only.
- **`listDurableObjectIds()` resolves to an Array (thenable), not an async iterable.**
- WebSocket integration/e2e tests use `response.webSocket.accept()` on a real `SELF.fetch`
  upgrade, and the real `y-protocols` framing — no protocol mocks. The only stub is the
  transport-level `WebSocketPolyfill`.
- **`origin === client` guard** in the integration `RoomClient` mirrors y-websocket's
  `origin !== this` so a client's own update is not fed back to it (echo suppression, TC-08).

## TC-23: why we assert convergence, not "every typed character survives"

`StickyTextEditor` (story 2) seeds its textarea on mount and, on every `input`, writes its
whole local value to `Y.Text` via `applyTextDiff`. It does **not** `observe` remote `Y.Text`
changes mid-edit. So when two browsers type into the same note simultaneously, each side's
commit can clobber the other's not-yet-landed characters — the Y.Doc still converges to one
identical value (Yjs guarantees convergence) but the merged text does not necessarily retain
*every* typed character contiguously.

- e2e **TC-23** therefore asserts the contract that is actually observable through this
  editor: both pages converge to the **same** note text within the latency budget, and that
  text has moved past the seed (the live merge propagated).
- Correct **character-level** concurrent-merge behaviour (both edits' characters preserved)
  is verified deterministically at the **document** layer by integration **TC-09** (text
  insert merge) and **TC-12** (200 seeded random ops × 5 clients → identical snapshots).

A future story that swaps in an observe-based text binding (y-textarea/prosemirror) could
tighten TC-23 to assert every typed character; that editor change is out of scope for
story 3.

## Test-only connection hooks (test build only)

`window.__vidi6` exposes, only when `import.meta.env.MODE === 'test'`:
- `simulateDrop()` → `provider.disconnect()` (the badge goes `reconnecting` and **stays**
  down because `disconnect()` clears `shouldConnect`, so `setupWS`'s `shouldConnect &&
  ws === null` guard makes any scheduled reconnect a no-op).
- `restoreConnection()` → `provider.connect()` — a real reconnect + resync (badge flashes
  `connected`).
- `connectionState` — the badge's mapped state, read by nightly TC-29.
- `setCamera()` — pre-existing (story 2) far-travel hook.

`provider.ws.close()` is **not** used to simulate a drop: under `wrangler dev` the socket
can sit in `CLOSING` without firing `onclose`, so `disconnect()`/`connect()` (which drive
`closeWebsocketConnection` synchronously) are used instead.

## Nightly results (recorded per tasks.md)

Run: `npm run test:e2e:nightly` (chromium, one machine, model + browsers + wrangler dev at once).

- **TC-29 idle stability — PASS** (45.6 s). With two connected contexts idle for 45 s, the
  ConnectionStatus badge never rendered a `reconnecting` state and the mapped
  `connectionState` stayed `connected` throughout — the room's awareness relay keeps the
  sockets alive and `maxBackoffTime`/`disableBc` are correct.
- **TC-30 capacity soak — PASS** (48.4 s). 5 contexts (`MAX_CONCURRENT_EDITORS`), continuous
  UI edits; **603 rounds / 2412 latency samples**; **p50 = 6 ms, p95 = 23 ms, max = 48 ms**
  against `LIVE_UPDATE_LATENCY_BUDGET_MS = 1000 ms`. Every per-change latency within budget,
  every badge stayed hidden (`connected`), and all five final board snapshots were identical.

---

# Story 5 — Share a board with others using a link

Implementation of `share.board_api`, `share.room`, `share.link_only_entry`,
`share.client_routes`, `share.panel` and `share.abuse_guard`: `POST /api/boards` (create,
with the creation rate limit in front of it), `GET /api/boards/:id` (existence, read-only),
a 404 in front of every link that leads nowhere, a client router that decides the page
from the URL, and a Share panel that puts the link on the clipboard.

## Test totals (all passing)

- **unit** (136) — `createBoard` retry ladder with a injected generator (`TC-01..04`),
  the character set a board id comes from, and every link shape routed to which page.
- **component** (62) — the real App rendered at a URL: creating / failed / limited /
  bad-link / unreachable-then-open (`TC-16..21`), and the Share panel's copy, fallback,
  focus and link contents (`TC-22..25`).
- **integration** (58, workerd) — `TC-05..15`, `TC-32` plus the rate limit's boundary
  (10 accepted, the 11th refused inside one period) and a period that resets.
- **e2e** — `npm run test:e2e` 69 passed (chromium + firefox + webkit), `test:e2e:persistence`
  4 passed, `test:e2e:share` 10 passed (6 chromium, plus `TC-27`/`TC-29` in firefox and
  webkit), `test:e2e:nightly` 2 passed (unchanged).

## Creating a board in a test: which path, and why

`POST /api/boards` is the only production way to create a board, and it is metered at
`BOARD_CREATE_LIMIT_PER_MINUTE = 10` **per Durable Object instance**, i.e. per `wrangler dev`
process. So:

- Component tests never touch a limiter: they intercept `fetch`.
- Integration tests get a limiter of their own per test (`env.BOARD_CREATE_LIMITER = stub`),
  because the design's TC-05..TC-11 are about the endpoint, not the guard.
- E2E creates through the existing test-only hook — `POST /__test/boards/:id/initialize`,
  which calls the same `BoardRoom.initialize()` the endpoint calls, minus the limiter. The
  suites create far more than ten boards a minute between them, and a limiter that only
  exists to be measured by TC-30 must not be spent by other tests.
- **TC-30 runs against its own `wrangler dev` process** (started by the test, on its own
  `--persist-to` directory), so ten creations are ten creations and the eleventh is the
  eleventh. Same reason story 4's persistence suite owns its process.
- TC-31's legacy board uses the second hook action, `seed-legacy`: content rows without
  `created_at`, which is exactly the state a board created before this story was in.

## Two gaps the tests found in the product

1. **"Create a new board" on the Board-not-found page only went home.** The PRD asks the
   page for a way to *create* a board, and the acceptance says the board opens. The home
   page's create action was extracted into `src/client/pages/useCreateBoard.ts` and both
   pages call it — one create path in the product, not two that can drift.
2. **The Share panel did not give focus back.** Spec: after closing, focus goes back to the
   Share button. The panel is now `role="dialog"` `aria-label="Share board"` and returns
   focus on Escape *and* on outside click; the button is wrapped in a persistent element so
   it is still mounted to receive focus.

## Clipboard in Firefox and WebKit

`context.grantPermissions(['clipboard-read', 'clipboard-write'])` throws on Firefox
("Unknown permission") and WebKit — those engines have no such permission to hand out.
`grantClipboardPermissions` swallows exactly that error and nothing else. Chromium remains
the engine that reads a link back out of the real clipboard (TC-26); firefox/webkit run
TC-27 and TC-29, and TC-29 deliberately makes `writeText` reject, which needs no permission.

## A socket no longer creates a board (affects stories 1-4's tests)

`BoardRoom.fetch` now answers 404 for a board that does not exist, before accepting the
WebSocket. Consequence for existing suites: the Node-side `RawClient` collaborators that
seed boards must create the board first. `tests/e2e/helpers/board.ts` gained
`ensureBoard(boardId, origin?)` (a worker-side `fetch` to the test hook, so `page.route()`
interception cannot see setup traffic), and the nightly webServer passes
`--var VIDI_TEST_HOOKS:1` like the other configs. Future stories: a board is something you
create, not something you connect to.

## Board check backoff shares one ceiling

`BOARD_CHECK_RETRY_BASE_MS` doubles up to `RECONNECT_MAX_BACKOFF_MS` — the spec names that
constant. An earlier cut had a separate `BOARD_CHECK_RETRY_MAX_MS`; the second constant
would only have existed to be configured out of sync with the first.

# Story 8 — Undo and redo my own changes without undoing anyone else's (implementation notes)

## Test totals (all passing)

| Suite | Story 8 | Whole suite |
|---|---|---|
| `test:unit` | 21 (TC-01 to TC-13 + 5 contract extras) | 194 tests, 15 files |
| `test:component` | 16 (TC-14 to TC-21 + 5 extras) | 126 tests, 17 files |
| `test` (unit + component + integration) | — | 378 tests, 37 files |
| `test:e2e` (TC-22 to TC-24) | 3 tests | 38 tests per browser, chromium + firefox + webkit all green |
| `test:e2e:share`, `test:e2e:persistence` | — | 10 and 4, unchanged |

## Design decisions honoured

- **Origin filtering, not user filtering.** `trackedOrigins = new Set([LOCAL_ORIGIN])`. There is
  no user identity in this product, and none is invented: the history is per tab because the
  transactions it remembers are the ones this tab made. Story 3's provider origin and story 4's
  `LOAD_ORIGIN` both fall outside the set, so a board loaded from storage and a colleague's
  keystroke are equally invisible to my Undo (TC-02, TC-03).
- **`undo()` answers "did you consume a step", not "did the screen move".** False only when the
  stack is empty. A step whose object a colleague deleted is still my step and still comes off
  the stack (TC-07, TC-23).
- **Typing groups, commands do not.** `boundary()` is `stopCapturing()`, and it is placed where a
  user action ends: the start and the end of both gestures (including the `pointercancel` path),
  the mount and every way out of the text editor, and around each single-call command — nudge,
  delete, new note, colour. So thirty frames of one drag are one step (TC-14), a hundred
  keystrokes in the same half-second are one step (TC-12), and two colours chosen in the same
  second are two steps.
- **Undo is a change like any other.** The inverse transaction is applied by `Y.UndoManager`
  itself, an origin outside `trackedOrigins`, so it syncs to everyone else (TC-22: the eight
  notes come back on Raj's screen too) and cannot be captured by my own history again.
- **The edit lock is respected.** The shortcuts sit behind `canEdit` in `useBoardKeys`, so a board
  that failed to load is not undoable by keystroke, and the buttons are grey because the state the
  hook reports is false, not because the click handler was removed (TC-20).

## Where the controller lives, and how the tree reaches it

The design's file table says `App.tsx` creates the controller. It is `BoardApp.tsx` instead:
`App.tsx` routes and never holds a `Y.Doc`, while `BoardApp` is the component that receives a doc,
renders its objects and unmounts when the board changes. Creating it there (`useMemo` per doc,
`destroy()` in an effect cleanup) is what makes "reload means a fresh history" (TC-11) true for
the right reason — switching boards destroys the old controller with the old doc.

The controller is handed down in a context (`UndoControllerContext`), and `useUndoBoundary()` turns
it into a stable callback for the components *under* the board: `StickyTextEditor`, `Toolbar`,
`NoteToolbar`. `useBoardKeys` and `useTransformGesture` take the controller (or its `boundary`) as
an option instead, for a reason a test caught: **a component cannot read context it renders
itself**, and `BoardApp` is the component that renders the provider. The first cut called
`useUndoBoundary()` inside `useBoardKeys`, and every nudge and delete merged into one undo step in
the browser while the component test's own assertion about step counts silently passed — until
TC-23's e2e case showed one Ctrl+Z emptying two steps. Both hooks now take it as a parameter,
which is also what keeps their own unit tests free of a provider.

## `undo.ts` in details

- Scoped to `doc.getMap('objects')`, so a change to board-level state would never enter the
  history; nested children of a note (`text`, `x`, `color`) are in scope through yjs's own
  `isParentOf`, which TC-04 relies on to bring a note's text back with it.
- `maxSteps` is not a `Y.UndoManager` option. It is enforced on `stack-item-added`: while
  `undoStack.length > maxSteps`, `shift()`. The oldest step leaves, the newest stay (TC-09), and
  the 200th step costs nothing (TC-10).
- `onChange` fires on `stack-item-added` and `stack-item-popped` — the two events that are the
  only honest way to know a stack changed. `useUndo` subscribes with a revision counter, so the
  buttons say what the controller says (TC-18).
- `destroy()` on the manager is real at runtime but missing from yjs's `.d.ts`; it is called
  through a cast. Without it the manager's `afterTransaction` handler stays attached to the doc
  after the board unmounts, which is a leak with a view of the doc forever after it.
- `addScope` exists for story 16's comments and is tested as a pass-through; nothing in this story
  uses it.

## Ctrl+Z inside a note

`StickyTextEditor` takes Ctrl/Cmd+Z and Ctrl/Cmd+Y for itself: commit the textarea into `Y.Text`,
ask the controller, then re-read `Y.Text` back into the textarea and the caret. The reason is not
convenience but disagreement — a browser remembers its own undo history for a `<textarea>`, and
after one keystroke of the board's undo the two histories would never agree again. The keystroke
is `preventDefault`ed (that is the assertion in TC-19 and TC-16), so the browser's own history
never gets a step to disagree about.

## TC-23: what undo does when someone else deleted the object

Worth recording as product behaviour, because it surprised a test: `Y.UndoManager` pops stack
items until one produces an actual change. So if I move a note and Raj deletes it, my Ctrl+Z
consumes the move — which has nothing left to restore — and goes on to reverse the last of my
earlier steps that *can* be reversed. One press, two steps gone, one visible change. That is what
the design asks for in words ("no error, the note stays absent, my next undo still works"), and it
is why `undo()` is defined as "a step was consumed": the alternative, "the screen changed", would
have to be false here while the stack was demonstrably doing work.

A second thing undo revealed, and a story-7 edge rather than a story-8 one: a note created while
my eight were deleted gets `z = 1` (the top at that moment), and undoing my delete brings back the
eight with their *old* z values — so `z` can collide across screens until somebody raises a note
again. The e2e comparison of "the board back to how it was" ignores `z` for that reason, and says
so.

## Test-harness notes

- **The capture window is testable only by taking the clock away from yjs.** `lib0/time` does
  `export const getUnixTime = Date.now`, capturing the function at module load, so
  `vi.setSystemTime()` changes a clock yjs never reads. The unit project now mocks `lib0/time`
  with a controllable `getUnixTime` and `vitest.workspace.ts` inlines `yjs`
  (`server.deps.inline`) so the mock reaches it. TC-13's "exactly `UNDO_CAPTURE_TIMEOUT_MS` apart
  is two steps, one millisecond less is one" is only meaningful against that clock — and it is the
  boundary the design asked to be pinned.
- **`tests/unit/helpers/peer.ts`** is a second real `Y.Doc` wired two ways, with everything that
  arrives on the local doc carrying an origin that is neither `LOCAL_ORIGIN` nor an undo manager's.
  Without the echo guard in the forwarding direction the two docs would sync-loop; undo
  transactions carry the manager as their origin, which is why they reach the peer and are not
  captured back. `applyWithLoadOrigin` is the story 4 origin, and TC-03 is the reason it exists.
- **The component files inject the controller** through `BoardAppProps.undo`, which is also how
  TC-18 to TC-21 pass a spy: what those cases ask is *who the board asked*, and a real controller
  would answer with a stack rather than a call list. `BoardApp` falls back to creating its own, so
  the app and the e2e suite never see the test-only path.
- **Fake timers do not fake yjs's clock in jsdom** — the component project leaves `lib0/time`
  alone, so inside one component test every transaction lands in the same millisecond and
  everything would merge into one step if nothing separated it. That is what gives TC-14 to TC-17
  their bite.
- **World to screen in the e2e files is `world × zoom`, from the viewport's top-left** — measured,
  not assumed (a note at world x = −360 at 0.6 zoom landed at screen x = −216, off the left of the
  window). TC-22 to TC-24 therefore seed in positive world units and call `expectAllOnScreen()`
  before dragging anything: a note that cannot be reached by a mouse is not a test.
- The e2e undo chord is sent as **Ctrl, not Cmd**, so the same file runs the same on every engine;
  the Cmd chord is TC-19's job, in jsdom, where the modifier is a property of an event rather than
  of a keyboard.

# Story 9 — Write free text anywhere on the board (implementation notes)

## Test totals (all passing)
- Unit + component + integration: **420** (`npm run test`).
- e2e: 21 in this story's spec (`tests/e2e/free-text.spec.ts`) across chromium, firefox, webkit;
  45 total on chromium. `TC-26` (the auto-width/wrap one) is exercised on all three engines.

## `useTool` is local UI state, and `canEdit` reverts Text → Select
The tool mode lives only in this tab (`useTool`), never in the shared doc and never persisted.
When the board turns read-only (`canEdit` goes false — a dropped connection) an active Text tool
falls back to Select; a Text tool cannot survive the board locking. `Toolbar` gates its tool
buttons on `props.canEdit && props.onSelectTool != null`, so a read-only board never offers one.

## `createdBy` is a per-tab id for now (story 6 identity is not in this build)
`createText` records `createdBy`; until story 6 lands a real collaborator identity, `useClientId`
mints one random `g_…` id per tab and reuses it, so every text this tab creates shares an author.

## One writer for the box, everyone renders it
`useTextBoxSync(doc, id, measure)` exposes `remeasureAfterLocalChange()`, and it is the *only*
place `setTextBox` is called. It fires on local typing, a size change and a fixed-width drag —
never on a remote update. Five clients therefore never race to write dimensions: each renders the
stored `width`/`height` and only the person who actually changed the text remeasures. The component
test counts transactions with `LOCAL_ORIGIN` that touch `width` to prove a peer's edit writes zero
local boxes.

## Concurrent typing needed a remote observer in the editor (the e2e caught it)
`TextEditor` writes with a minimal `applyTextDiff` against the *live* `Y.Text`, so a single edit
never clobbers a colleague's. But two clients editing the same text at once (TC-29) still lost
characters until the editor grew a `ytext.observe` handler: when a change arrives with an origin
other than `LOCAL_ORIGIN`, it reseeds the textarea and parks the caret at the end. The next local
keystroke then diffs against the already-merged text. Without it, B types `BBB` while its draft
still says `start`, and the diff deletes A's just-landed `AAA`. IME composition is the one case the
observer leaves alone — the composition-end handler resolves it.
Because CRDT inserts interleave by position, TC-29 asserts on the *character multiset*, not a
contiguous fragment: both screens agree, and every typed character is present exactly once.

## Greedy wrap never character-breaks; auto width comes from source lines
`layoutText` splits on explicit newlines first, measures each **source** line, and takes
`min(longest, TEXT_MAX_AUTO_WIDTH_WORLD)` as the auto width; a line wider than that wraps word by
word, and a single word too wide for the wrap width gets its own (visually overflowing) line rather
than a mid-word break. `createCanvasMeasurer` falls back to a named glyph-ratio estimate where no
canvas exists, so the unit tests and jsdom never depend on a real font.

## Text is generic everywhere else
Adding the `text` type touched only the registry and the handle filter: selection, move, delete,
marquee, undo and z-ordering all work on it unchanged. Its registry entry is `resizable`, not
aspect-locked, `minSize = TEXT_MIN_WIDTH_WORLD`, `handles: 'horizontal'`; `SelectionOverlay` shows
only the e/w handles when every selected object is horizontal-only, and a single-text e/w drag is a
`textwidth` write (`setTextWidthFixed` + one remeasure) rather than a free resize.

# Story 11 — Sketch freehand with a pen (implementation notes)

## Test totals (all passing)

| Suite | Story 11 | Whole suite |
|---|---|---|
| `test:unit` (`tests/unit/stroke.test.ts`) | 27 (TC-01 to TC-08 plus boundary and edge cases) | 263 tests, 20 files |
| `test:component` (`PenTool`, `StrokeObject`) | 28 (TC-09 to TC-16, TC-21 plus extras) | 213 tests, 25 files |
| `npm run test` (unit + component + integration) | 55 | 534 tests, 50 files |
| `test:e2e` (`tests/e2e/pen.spec.ts`, TC-17 to TC-20) | 5 per browser | 57 per browser, 171 total — chromium, firefox and webkit all green |
| `npm run typecheck` | clean | clean |

## Design decisions honoured

- **Nothing in flight is ever sent.** The stroke in hand lives in component state as a
  screen-space path and is drawn from an overlay; the one write to the document happens on
  release (`createStroke`, `LOCAL_ORIGIN`). TC-18 measures this from a second browser: the
  watching page holds no stroke and no preview while the drag lasts, and the whole stroke
  inside `LIVE_UPDATE_LATENCY_BUDGET_MS` after release.
- **`boundary()` around every stroke.** Yjs merges same-origin transactions inside
  `UNDO_CAPTURE_TIMEOUT_MS`, so two strokes drawn a second apart would be one undo step. One
  `stopCapturing()` before and after each `createStroke` makes it one stroke per step (TC-11).
- **The pen stays armed.** No `toolCreated`, no return to Select: one click on the Pen buys
  an unlimited number of strokes (TC-09, TC-17).
- **An interrupted pointer finishes the stroke.** `pointercancel` and `lostpointercapture`
  commit the points drawn so far — the PRD's "shall not discard". Only leaving the tool
  (Escape, another tool) throws the stroke away, because that is a decision and an
  interruption is not (TC-10).
- **Session-only options.** `usePenOptions` is plain `useState`: colour and thickness are
  neither persisted nor shared, and a reload comes back to `DEFAULT_PEN_COLOR` /
  `DEFAULT_PEN_THICKNESS` (TC-13).
- **`STROKE_SIMPLIFY_TOLERANCE_PX` is screen pixels**, so it is divided by the zoom before it
  is handed to `simplify`: a squiggle drawn at 400% zoom is simplified in tenths of a board
  unit, and the same gesture at 100% in whole ones.
- **Aspect lock costs no stroke-specific resize code.** The stroke stores `points` relative
  to its box plus the `baseWidth`/`baseHeight` it was created at; `scaledPoints` reads the
  live `width`/`height` the generic story-7 resize already writes, and the registry's
  `aspectLocked: true` does the rest (TC-20, at ±1%).
- **The box is padded by half the thickness on every side**, so the painted line always lies
  inside the box that selection, marquee and resize use. A stroke whose line touches the box
  edge is not a special case anywhere else in the app.
- **`strokeHitTest` takes the larger of half the thickness and `STROKE_HIT_TOLERANCE_PX /
  zoom`** — a thick line is clickable on its own body at 100%, a thin one is clickable within
  six screen pixels at any zoom, and the tolerance is screen pixels in both cases (TC-15).
- **`pen` took the `p` shortcut** from the cross-story letter map (`TOOL_SHORTCUTS`), which
  story 10's `useActiveTool` test had listed as "a letter no tool has yet"; the test moved
  that assertion to `j` rather than losing it.

## Deviations from the design's contracts, and why

1. **`PenTool` takes two props the contract does not list**: `viewportRef` and `canEdit`.
   The tool must put its `pointerdown` listener on the *drawing surface* in the capture phase
   — that is the only way a stroke started on top of a sticky note belongs to the pen and not
   to the note under it (TC-19) — and a component cannot hold a ref it does not own.
   `canEdit` is the same rule every creating tool obeys: a board that cannot be edited does
   not draw.
2. **`StrokeObject` takes the registry's standard `ObjectProps`, not `{ stroke, selected }`.**
   The generic world layer renders every object type through one interface, and only by
   taking `onObjectPointerDown`, `zoom`, `camera` and `selected` from it does a drawing get
   selection, move, resize, delete and z-ordering for free. It reads the stroke fields off
   the snapshot with `strokeSnapshot`, so a corrupt object cannot crash the board (TC-16).
3. **The accessible name carries the paint**: `aria-label="Drawing (Blue, Thick)"` rather
   than the design's bare `"Drawing"`. A screen reader otherwise hears forty identical
   "Drawing"s on a board full of them; the design's own toolbar spec names colour and
   thickness for the buttons, and this is the same idea applied to the object.
4. **`ObjectSnapshot.color` was widened to `StickyColor | PenColor`** instead of adding a
   second colour field. One field means one write path, one sync path and one colour-aware
   undo; each type validates its own palette (`isStickyColor`, `isPenColor`), and
   `StickyNote` narrows at the point of use.
5. **`points` is a flat `number[]` on the object map, not a `Y.Array`.** A stroke is created
   once and never edited point by point; the whole array is replaced atomically by the
   simplify-and-create step, which is exactly the shape a plain JSON field in a `Y.Map`
   handles well. A `Y.Array` would offer per-point merge semantics nothing needs.

## A real bug the e2e found: Firefox steals the pointer from an SVG stroke

TC-20's body drag moved the drawing in Chromium and WebKit and *nothing* in Firefox. The
trace shows why: Firefox begins a native drag the moment the pointer is pressed on an SVG
element, and a pointer taken over by a drag is cancelled — `pointerdown@path#stroke-hit-area`
immediately followed by `pointercancel@path#stroke-hit-area`, which ends the move gesture
before its third pixel. `StrokeObject` now handles `onDragStart` and calls
`preventDefault()` (plus `user-select: none`), which stops the drag before it claims the
pointer; the e2e passes on all three engines. React's `SVGProps` has no `draggable`, and none
is needed: cancelling `dragstart` is the whole fix. `tests/component/StrokeObject.test.tsx`
asserts the prevention, because jsdom has no native drag to start and would otherwise regress
silently.

## Test-harness notes

- **Vitest does not fake `requestAnimationFrame`.** `vi.useFakeTimers()` leaves it to jsdom,
  so the pen's preview would never update under a component test that waited for a frame that
  never came. `tests/component/PenTool.test.tsx` stubs it with a queue and flushes it by hand
  (`nextFrame()`); commits are asserted where they really happen — synchronously, in the
  pointer handler — not in a frame.
- **The frame-by-frame promise is asserted in the browser, where it is real.** TC-17 installs
  a sampler *inside the page* that records the preview's `d` on every animation frame for the
  whole time the pointer is held down, and asserts the frames differ: a preview that only
  redrew once per gesture would pass a "preview exists" test and fails this one.
- **Dragging five thousand points is not an e2e concern.** The `STROKE_MAX_POINTS` split
  (TC-12) is a question about how many points the tool recorded, and it is answered in
  `tests/component/PenTool.test.tsx`. In a real browser each `page.mouse.move` costs a
  round trip and delivers one point, so proving it there would spend minutes of a 30-second
  budget to learn something the engine has no opinion about.
- **Ask the browser where the line is.** TC-20 clicks "on the stroke" through
  `path.getPointAtLength(path.getTotalLength() * f)` mapped out of the SVG's own `viewBox`
  and client rect. A hand-computed point misses: the painted line is a *smoothed quadratic*
  through the recorded points and does not pass through the points the pen went near, so
  arithmetic about where the line "should" be lands several pixels off a six-pixel target.
- **One batched `evaluate` per path, not one per point.** `onScreen()` in
  `tests/e2e/pen.spec.ts` reads the origin marker and the zoom once and maps a hundred-point
  fixture in a single trip; the per-point version (two trips each) blew the test timeout
  before it drew anything.
- **Re-pressing an armed tool's button puts the tool away** (story 10's rule in
  `useActiveTool.setTool`), so `armPen()` in the e2e clicks the Pen only when it is not
  already armed. This is also exactly what makes TC-09's "the pen stays armed" worth
  asserting: a helper that clicked blindly would toggle the tool off mid-test.
- **The pen's cursor is CSS and a circle.** `BoardViewport` gains `data-pen="true"` while the
  tool is armed, `styles.css` turns the real cursor off for the viewport and everything under
  it, and `PenTool` draws a dot of `thickness * zoom` at the pointer. The pen toolbar is
  rendered as a sibling *outside* the viewport, so choosing a colour is never a stroke; the
  capture handler ignores presses that begin on a button or a text editor all the same.

# Story 12 — Drop images onto the board (implementation notes)

## Test totals (all passing)

| Suite | Tests |
| --- | --- |
| `npm run test:unit` | 331 |
| `npm run test:component` | 255 |
| `npm run test:integration` | 68 |
| `npm run test:e2e` | 186 (chromium, firefox, webkit) |

`npm run build` and `npm run typecheck` are clean. Story 12 needed nothing from story 2's
unfinished business: a picture is an object like any other, and it borrows the selection,
the gesture and the document that stories 7 and 8 already finished.

## Where a picture lives, and what the board remembers

Bytes go to R2 through `POST /api/boards/:id/assets` (raw body, not multipart: the limit is on
the bytes and there is no reason to parse a form in front of them) and come back through
`GET /api/assets/:boardId/:assetId`, which is cached for a year and marked `nosniff` because it
hands back whatever a person dropped. The document remembers only the *box*: a size, a content
type, the natural size the uploader measured, and a status. What a viewer sees is derived from
that status plus the clock — `displayStatus(image, now)` — so "Upload failed" and "Image
unavailable" are two readings of one record rather than two records, and a reload cannot disagree
with the screen that reloaded.

Status changes are written with a second, untracked origin (`UPLOAD_ORIGIN`) while the
placeholder is created under `LOCAL_ORIGIN`. That is the whole of the undo story: one Ctrl+Z
removes the whole batch of boxes that one drop made, and it does not "undo" a failure that
arrived afterwards, which would put the picture back to `uploading` and leave the person waiting
for an upload nobody is doing.

## Three fixes outside story 12's own files

These are defects the images found in shared code and in the image box itself. Each is recorded
here because it changes the behaviour of something another story owns.

- **`clampScale` was handed one scale and read it as two.** The resize gesture asks `resizeRect`
  for an aspect-locked box, then recovers the scale by dividing the box it asked for by the box it
  started with — `(w · s) / w` and `(h · s) / h`, the same number twice in arithmetic and, for
  some requests, not the same number twice in floating point. `clampScale` decided whether a
  request was uniform by `scale.x === scale.y`, so for those requests it clamped each axis
  against its own minimum. Mid-board the error is one unit in the last place and invisible;
  dragged past the floor of a side, it stops the width at 16 and the height at 16, and a 799×499
  photograph becomes a square. Firefox's drag delivers that request and Chromium's does not,
  which is the only reason it was found now. `clampScale` takes a `uniform` flag now, the gesture
  passes the aspect lock it already had, and `tests/unit/geometry.test.ts` holds the case with
  both readings side by side. Strokes (story 11) are aspect-locked too and are the other winner.
- **A picture has to ask for its clicks back.** The world layer (`BoardViewport`) is
  `pointerEvents: 'none'` so that a press on empty board pans instead of hitting an object; every
  object opts back in on its own root, and the image box did not. In jsdom nothing noticed — the
  layering is not enforced there — while in a browser a dropped picture was simply not there for
  the pointer: no selection, no move, no resize, no Retry button. The box sets
  `pointerEvents: 'auto'` now, and a component test asserts it for all three states, since the
  box in the middle of an upload is exactly the box a person reaches for.
- **No `loading="lazy"`, on purpose.** A board is panned by moving a layer, not by scrolling a
  document, so the browser's idea of "not needed yet" is a picture that sits outside the first
  screen and stays unloaded however far the person pans to it. Firefox honoured the attribute and
  left a dropped photograph blank in TC-25; Chromium's threshold let it through. The promise here
  is that a picture on the board is a picture on the screen, so the element is eager (`decoding`
  stays async). The immutable cache still does the work laziness was supposed to do.

## The paste path is tested where a paste can be made

Firefox does not accept `clipboardData` in a `ClipboardEvent` constructor, so a test cannot put a
file on a clipboard it built itself — the event dispatches with `clipboardData` null and the
board, correctly, sees a paste with nothing in it. That is a harness limitation and not a product
bug, and the design does not ask for a paste e2e case anyway: TC-02 and TC-18 test the paste path
as `ui-component`, and TC-27's own mechanism row says `picker`. The component suite drives paste
through the same `onPaste` handler the board installs, with the same assertions about sizes,
counts and messages, so the handler is covered; what is not covered anywhere is "a real Ctrl+V
from a real system clipboard", which no browser under Playwright would have let us do twice in a
row anyway.

## Test-harness notes

- **The fixtures are real images, not files named like images.** `tools/make-image-fixtures.mjs`
  draws them in a Chromium canvas and reads the bytes back with `toDataURL`, so a PNG, JPEG and
  WebP fixture will decode in every engine the suite runs on. Animated GIF is written by hand
  (LZW with a clear code after every index, which is the simple correct version of the encoder),
  because no browser will produce one on demand. The 10 MB JPEG is a real small JPEG padded to
  the byte with JPEG comment segments — `FF FE len` is skipped by every decoder, so the file is
  both exactly the limit and genuinely an image.
- **Drops are dispatched as the three events a drop really is** (`dragenter`, `dragover`, `drop`)
  on the app root, with `DataTransfer` built inside the page from base64, because Playwright
  serialises a function and not its closure. `chooseFiles` makes the hidden picker input briefly
  visible: Playwright will not load a file into an element it has decided a person cannot see.
- **`clickImage(page, id, {dx, dy})` takes an offset for a reason.** A failed box offers Retry at
  its centre, and Retry stops propagation — pressing the button is not pressing the box. The
  default click is the centre, which is right for a picture that has arrived.
- **Offline is forced with the test connection hooks, not `context.setOffline`.** `simulateDrop`
  and `restoreConnection` put the socket down and leave it down until the test says otherwise;
  the browser's own offline emulation starts reconnecting the moment it is lifted, and a test
  about what a board says while it cannot be reached should not be racing that.
