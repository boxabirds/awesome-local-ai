# Notes

Decisions, deviations and environment findings, story by story: story 1 (everything
up to "Findings while testing the implementation"), then story 2, 3, 5 and 7 as their
own sections at the end.

## Ports

The allowed range is 20784–20799. Defaults: `npm run dev` → 20786 (Vite),
`npm run e2e:serve` / Playwright → 20784 (`wrangler dev`), inspector → 20785.
All three are overridable (`VIDI6_DEV_PORT`, `VIDI6_E2E_PORT`,
`VIDI6_E2E_INSPECTOR_PORT`). `server.host = true` is set in `vite.config.ts` so the
dev server answers on both `127.0.0.1` and `localhost` (with the Vite default it
bound to the IPv6 loopback only and `curl http://127.0.0.1:20786` failed);
`strictPort` is deliberately off so a busy port moves to the next free port in
range instead of exiting.

## Contract deviations (all additive)

- **`BoardViewport` takes a `controller` prop.** The design's contract is
  `BoardViewport(props: { children?: ReactNode })`. One camera has to be shared by
  the viewport, the zoom control and the hint, so `App` calls `useCamera` and passes
  the resulting `CameraController` (camera, `hasNavigated`, `isPanning`, and the
  handlers named in the `useCamera` contract) down as a prop. `children` still works
  and is rendered in world coordinates.
- **`useCamera` returns a superset** of the contract: `isPanning` (drives
  `data-panning` and the grabbing cursor), `zoomBy(factor, point)` (the Safari
  gesture path) and `setCamera(patch)` (the `window.__vidi6` hook). Everything named
  in the contract is there with the documented signature.
- **`hasNavigated` is `useState` backed by a `useRef` latch**, because a ref alone
  cannot re-render the hint away. The latch semantics from the design hold: it only
  flips when `camera.ts` returns a *different* object, so TC-29 (click without
  movement, no-op zoom at a limit) does not dismiss the hint, and it never resets
  during the visit.
- **Extra files:** `src/client/canvas/testHooks.ts` (the `window.__vidi6` fixture,
  listed under "Fixtures" in the design) and `src/client/styles.css`.

## Camera maths

Exactly as specified: immutable `Camera`, `x`/`y` = world point at the viewport's
top-left, `zoomAt` keeps the world point under the pointer and returns the *input
object* for no-ops and invalid factors, `zoomStep` snaps to the nearest
`ZOOM_STEP_FACTOR^n` (epsilon `STEP_SNAP_EPSILON = 1e-9`) so 125 % → 100 % lands on
exactly 1.0. All limits come from `src/shared/config.ts`; `PERCENT = 100` is named.
The unit suite includes the seeded 1,000-case property check for pointer invariance.

## Grid rendering

The dot grid is the viewport's own `background-image` (radial-gradient), with
`background-size = GRID_SPACING_WORLD * zoom` and `background-position` = `-camera.xy *
zoom mod spacing`, so dots stay welded to world intersections. Two details:

- CSS values go through `px()`, which renders `Number(value.toFixed(6))`. Camera
  values around 1e6 would otherwise serialise as `1e+6px`, which CSS rejects.
- The offset is taken modulo the spacing so it stays small at any distance; that is
  what makes 1,000,000 units out look identical to 0.
- The world layer uses `transform: scale(zoom) translate(-x px, -y px)` with
  `transform-origin: 0 0` (one composited transform, no per-dot DOM). The origin
  marker counter-scales by `scale(1/zoom)` about its own centre so the crosshair
  stays a fixed screen size while its centre stays welded to world (0,0).
- The world layer is `pointer-events: none`; object stories re-enable it per object.
  `cursor: grabbing` is applied to the viewport while panning.

## Event handling details worth remembering

- `wheel` is bound natively with `{ passive: false }` (React's `onWheel` is passive)
  and always `preventDefault()`s — that plus prevented Safari `gesture*` events and
  the three prevented shortcuts is what keeps page zoom from moving.
- `deltaMode` is converted with named constants: `WHEEL_DELTA_LINE_PX = 16`,
  `WHEEL_DELTA_PAGE_FRACTION = 0.9` of the viewport height.
- The keyboard shortcuts are on `window` (the viewport is a `div` and does not take
  focus first), are skipped when the target is editable, and handle `=`/`+`,
  `-`/`_` and `0` with Ctrl **or** Cmd. `Ctrl/Cmd + 0` is prevented, which also stops
  the browser's own "reset zoom".
- Drag starts only when `event.target` carries `data-board-surface` (the viewport or
  the grid), so object stories can own their own pointerdown.
- `lostpointercapture` is handled with a **native listener on the viewport** rather
  than React's `onLostPointerCapture`: React's root-delegation does not deliver that
  event in jsdom, and a native listener is also closer to the browser's own dispatch.
- The zoom control stops wheel propagation (passive listener) so Ctrl-wheel over the
  buttons never reaches the board (TC-30).

## Test infrastructure

- **Vitest projects**: `unit` (node, `tests/unit/**`), `component` (jsdom,
  `tests/component/**`, setup `tests/component/setup.ts`). Config lives in
  `vitest.config.ts` (Vitest reads the `projects` field there; `vite.config.ts` stays
  build-only).
- **rAF batching vs fake timers:** the design suggested fake timers. The hook batches
  with `requestAnimationFrame`, and jsdom's rAF plus React 19's `act()` interact badly
  with fake timers, so component tests use a real ~40 ms `settle()` inside `act()`
  (exported from `tests/component/harness.tsx`) to let the queued frame land.
- **jsdom gaps** (all guarded in the implementation, so production code is unaffected):
  no `setPointerCapture`/`hasPointerCapture` (tests fire `lostpointercapture`
  directly), no `ResizeObserver` (the viewport size comes from `window.innerWidth` in
  the harness), and `PointerEvent`/`WheelEvent` constructors exist but Testing Library
  `fireEvent` cannot build them with pointer semantics — the harness dispatches
  `window.PointerEvent` instances itself. `@testing-library/user-event` is installed
  per the design's dependency list but is not used for the viewport, because it
  cannot express pointer capture or Safari gesture events.
- `IS_REACT_ACT_ENVIRONMENT` is set in the component setup file (React 19 requires it).
- Component tests assert on the *rendered* camera (`data-camera-x/y/zoom`) and the
  world layer transform rather than on internals, and expected values are computed
  from the same config constants the implementation uses.

## E2E

- The `test:e2e` webServer runs `npm run e2e:serve` (`vite build --mode test` +
  `wrangler dev --local`), so the tests hit the real serving path.
- `window.__vidi6.setCamera/getCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified by grep: the production bundle contains
  zero occurrences of `__vidi6`, the test build contains it.
- **Firefox and WebKit cannot launch in this sandbox** (`SIGABRT` / `Abort trap: 6`
  during browser start, before any test code runs). Chromium passes 7/7. Instead of
  deleting the two projects from the browser matrix, the project list is env-driven:
  the default is `chromium` (so `npm run test:e2e` is green everywhere) and
  `VIDI6_E2E_PROJECTS=chromium,firefox,webkit npm run test:e2e` runs the full matrix
  on a machine where those browsers start. This is the only story-1 task that could
  not be fully executed here.
- `wrangler.jsonc` declares **no `ASSETS` binding**: wrangler 4 rejects an asset
  binding in an assets-only Worker ("Cannot use assets with a binding in an
  assets-only Worker"). The binding comes back with story 3's `main` entry point.
  `not_found_handling = single-page-application` is kept.
- Playwright waits on state, not sleeps: `expect.poll` on the rendered camera,
  `toHaveText` on the label. `dragAndSettle` asserts the camera delta itself, which
  is how "200 px drag moved the board exactly 200 px" is checked 1e6 units out where
  the marker is off screen; the on-screen variants measure the origin marker's
  `boundingBox()` centre.

## Findings while testing the implementation

- An early version of the grid test asserted `background-position` with `Number()`,
  which returns `NaN` for fractional CSS values like `12.5px`; `Number.parseFloat`
  is the right parse. Not an implementation bug.
- A component test that left a drag open (no `pointerup`) made the following drag's
  delta start from the previous drag's last point, which is correct behaviour for
  `beginPan` being a no-op while already `Panning` — the test now ends its drags. This
  confirmed the state machine really ignores a second `pointerdown`.
- `expect.closeTo(v, 6)` is too tight for e2e because the `data-camera-*` attributes
  are rounded to 6 decimals; precision 5 is used for camera comparisons.
- TC-33 (shortcuts while the address bar has focus) is not testable in-page, as the
  design says; nothing implemented for it.

---

# Story 2: sticky notes

## Contract deviations (all additive)

- **`createSticky` returns `string | false`** instead of `string | null`, and
  **`moveObject` returns `false` for a no-op as well as for a rejection**. The design
  only says "returns null / returns false"; the point of the return value is "did this
  mutate the document", and every mutation test asserts exactly one `update` event, so
  a no-op has to be `false` too. `LOCAL_ORIGIN = 'vidi6:local'` is exported from
  `board-model.ts` and passed to `applyTextDiff` so the diff helper can skip its own
  updates.
- **Extra config constant: `STICKY_PADDING_WORLD = 12`.** The design's constant list has
  no inner padding, but the text box, the editor and the fade all need the same inset,
  and the note's content box (`STICKY_SIZE_WORLD - 2 * 12 = 176`) is what the auto-fit
  measures against. It is handed to CSS once per note as `--sticky-pad`, so there is
  one source of truth.
- **`StickyNote` takes a `doc` prop** (plus `onDeleted` for the toolbar's bin button)
  besides the props in the design's signature, because the note writes to the document
  itself (drag, colour, delete) rather than through callbacks.
- **`BoardViewport` takes two more optional props**: `onCreateSticky(world)` (a
  double-click on the board surface, already converted to world coordinates) and
  `onClearSelection()` (a press on the surface that never passed the drag threshold).
  Both are gated on `data-board-surface`, so an object's double-click and press never
  reach them.
- **`App` is now a thin default export over a named `Board`**, which accepts
  `{ viewport?, handle? }`. `viewport` pins the window size for jsdom (which has no
  layout and reports 0x0) and `handle` exposes `{ doc, notes, selection }` to component
  tests. Rendering `<App />` is unchanged.
- **`isTypingTarget` lives in `StickyTextEditor.tsx`** and is imported by `App` for the
  window-level Delete/Backspace/Enter handler, so there is one definition of "focus is
  in a field".
- **Extra `data-*` attributes for testability**, all documented in the tests that read
  them: `data-interaction` on a note (`unselected | pressed | selected | dragging |
  editing`), `data-x/y/z`, `data-font-px` (computed font size, in world units),
  `data-overflow`, and `--inv-zoom` on the world layer so the note toolbar can
  counter-scale with the camera.

## Dragging: pointer capture is not something you can lean on

Two findings from the first real-browser run, both of which the component suite could
not see (jsdom has no `setPointerCapture` and no layout):

- **Coming to the front drops pointer capture.** A drag starts with `bringToFront`,
  which changes the note's `z`; the note list is rendered sorted by `z`, so React moves
  the note's DOM node, and Chromium releases pointer capture for a node that is taken
  out of the tree. The resulting `lostpointercapture` ended the drag on the very first
  `pointermove` — the note never moved. `onLostPointerCapture` is gone: the drag is
  ended by `pointerup`/`pointercancel` only.
- **Following the pointer needs a capture-phase window listener.** While dragging, the
  note's own `pointermove` handler calls `stopPropagation()` so the board never pans,
  which also stops the event from ever reaching a bubble-phase `window` listener. So
  the listeners that keep the note under the pointer (moves outside the note's box,
  `pointerup`, `pointercancel`) are registered on `window` with `capture: true` while
  `dragging` is true, and removed on cleanup. Capture calls are wrapped in
  `try/catch`, because a pointer that is no longer active makes `setPointerCapture`
  throw and that used to abort the handler before it wrote a position.
- **The flush has to run before the session is cleared.** `finishDrag` originally set
  `dragRef.current = null` first and then called `writePosition()`, which reads
  `dragRef.current` and silently returned: the last pointer position was never written
  (up to one frame of lag at the end of every drag). Now: cancel the pending frame,
  flush, then clear.
- Positions are written once per animation frame, from `lastClient{X,Y}`, so
  `data-x/data-y` can trail the pointer by a frame. E2E reads use `expect.poll` on the
  note position rather than reading the DOM immediately after a synthetic move.

## Text, limits and auto-fit

- The editor is **uncontrolled** (`defaultValue` from the `Y.Text`) and every `input`
  event writes a minimal diff straight into the `Y.Text`; ending editing performs no
  further write, so nothing typed is lost if a remote peer deletes or recolors the note
  mid-edit. `applyTextDiff` keeps the common prefix/suffix and replaces the middle —
  a keystroke is one `insert`, never a rewrite of 1,000 characters — and never splits
  a surrogate pair, so an emoji is typed and deleted as one character (TC-20, TC-38).
- **Too-long input is taken back**: on a clamped input the textarea's own value is
  reset to the kept text and the caret is put at the end, which is what keeps a
  1,200-character paste from leaving the extra characters on screen (TC-15).
- **IME**: `compositionstart` sets a flag, `input` events during composition only update
  the counter, and `compositionend` commits `el.value` once (TC-16, TC-26). Escape is
  ignored while composing: during a composition the input method owns Escape.
- **Auto-fit** is a binary search between `STICKY_FONT_MIN_PX` and `STICKY_FONT_MAX_PX`
  over a hidden mirror of the text box (`.sticky-measure`, the same width and
  `overflow: hidden`), so "the text never renders outside the note box" holds at 50 %,
  100 % and 200 %: zoom scales the whole note, the fitted font size is in world units.
  When even the smallest font overflows, the fade element is rendered
  (`data-overflow="true"`), and the whole text is still in the DOM — the fade is only
  a gradient over the bottom of the note (TC-17, TC-33).

## Test infrastructure added in story 2

- `tests/fixtures/texts.ts` is the only source of long note text: the golden-path
  phrase, a three-line retrospective item, an exactly-1,000-character English paragraph
  (built from real sentences, so it wraps like real text) and a 1,200-character paste.
  Surrogate-pair text lives with the tests that need it: nothing splits an emoji —
  `applyTextDiff` keeps pairs intact (TC-13) and `clampToLimit` drops a dangling high
  surrogate instead of leaving half an emoji behind (TC-15). The limit is counted in
  UTF-16 code units, which is what `Y.Text` indexes and what the counter shows.
- `tests/component/harness.tsx` gained `renderBoard()` (whole `Board` with a pinned
  viewport, an empty note list and a `handle`), plus `dragOn`, `click`, `type`,
  `setInput`, `doubleClick`, `noteText`, `centredOn` and `nextFrame`. Tests that need
  real Yjs behaviour use a real `Y.Doc` and count `update` events; no Yjs call is mocked.
- `tests/e2e/helpers/board.ts` is page-first like story 1's helpers and adds
  `doubleClickCreate`, `toolbarCreate`, `pressNoteAndMove`, `dragNote`,
  `waitForNoteAtRest`, `noteWorld`, `noteScreenBox`, `noteColor`, `noteInteraction`,
  `noteFontPx`, `noteText` and `editorValue`. **`setCamera` now waits for the rendered
  camera** (`expectCamera`) after calling the hook, because the patch goes through React
  state and the DOM attribute lands one frame later — reading it immediately used to
  return the pre-patch camera and made an assertion about a note's world position
  meaningless.

## Findings while testing the sticky note implementation

- A component test cannot see anything about overflow: jsdom's
  `getBoundingClientRect()` is all zeros, so font fitting and the fade are only asserted
  in e2e; the component suite asserts `data-x/y/z`, `data-interaction`, text and colour
  instead.
- `data-interaction="pressed"` only exists inside a pointer session, so the note
  re-renders (`setPressRender`) when the session opens and closes; without that the
  attribute would skip the state the tests are named after.
- `expect.closeTo(v, 2)` is still too tight for a note position read straight out of the
  DOM after a synthetic mouse move (Playwright's own coordinates can be fractional);
  precision 0 is half a world unit, which is far stricter than the PRD's "grabbed point
  within one screen pixel" and is what the drag tests use.
- Firefox and WebKit still cannot launch in this sandbox (`SIGABRT` / `Abort trap: 6`
  during browser start, before any test code runs) — the same finding as in story 1, so
  the 38 sticky note e2e tests were run in chromium only, three times over, with no
  flakiness. `VIDI6_E2E_PROJECTS=chromium,firefox,webkit` fails in `browserType.launch`,
  not in an assertion.
- `BoardViewport`'s `onCreateSticky` already passes **world** coordinates (the design says
  "the point is converted screen→world before it reaches here"). App passed it through
  `screenToWorld` a second time, which put notes at `(screen - cam)/zoom` instead of
  `screen + cam`: invisible until you panned, and invisible to the drag tests because the
  note box and the pointer were both off. Both creation paths now agree on "world in".
- **Keyboard-only authoring had a gap**: Enter/Delete were wired to the *selection*, but
  Tab-focus and selection are different things — a keyboard user could focus a note and
  nothing happened. The shortcuts now fall back to the focused note
  (`event.target.dataset.noteId`), and only for the note element itself: a focused swatch
  or bin button keeps the browser's own Enter/Delete meaning.
- Chromium's sequential focus navigation resumes **after the position of the element that
  was removed**: after the editor unmounts, the first Tab goes to the note's first toolbar
  button, and the note element itself is reached only when the ring wraps around. A Tab
  test therefore walks the ring (bounded) instead of asserting "the first stop is the note".
- Test marker files (`.test-unit`, `.test-component`, `.test-e2e`, `.dev-server`, …) appear
  in the repository root while the scripts run; `git status` should not be alarmed, they
  are removed when the run finishes and are not committed.

## Final test counts (story 2)

| Suite | Files | Tests |
| --- | --- | --- |
| `npm run test:unit` | 3 | 65 (25 board-model, 24 camera from story 1, 16 sticky-text) |
| `npm run test:component` | 6 | 65 (16 StickyNote, 10 StickyTextEditor, 14 Toolbars, 25 from story 1) |
| `npm run test:e2e` | 5 | 38 (31 sticky note, 7 from story 1), chromium, `--repeat-each=3` stable |

`npm run build` and `npm run typecheck` are clean.

## The test helper was the bug, not the board (TC-27)

`TC-27` failed with "the badge never goes away" while the board's own log said it had reconnected
and the page snapshot showed the badge gone. Reading the page at one second per line was the way
out: the board publishes `connected`, React renders it, the badge is gone, all within three seconds
of the network coming back. What did not work was the *test* finding that out: `badgeText()` read
the badge through a locator, which waits for the element to be there, and the helper called it in a
loop that expects the badge to be *gone*, racing each call against a 200 ms timeout. Every round
left a call waiting for an element that never comes back, and after a while those pending calls
hold up everything else asked of that page — including the reads that would have shown success. So
the test reported a stale state for 45 s while the page was fine.

`badgeText()` now reads the DOM with `page.evaluate`, which answers immediately whether the badge
is there or not. Rule taken away: **inside a poll that waits for something to disappear, do not use
an API that waits for it to appear.** When a page seems to stop reporting the truth, check whether
the observation itself is queued.

---

# Story 5: share a board with others using a link

## Contract deviations (all deliberate)

- **`App.tsx` is two files now.** `git mv src/client/App.tsx src/client/board/Board.tsx`, and the
  new `src/client/App.tsx` is a router shell: `useRoute()`, then `HomePage`, `BoardPage` or
  `NotFoundPage`. Story 4's board is unchanged in behaviour; it just no longer owns the address.
  Two reasons, one of them mechanical: `App → BoardPage → Board → App` is a cycle, and one of them
  had to stop importing the other.
- **`pages/state.ts` with `nextBoardPageState` did not happen.** The states are exactly the ones in
  the contract — home: `idle | creating | failed`; board: `checking | ready | notFound |
unreachable` — but they are React state in the two components that use them, not a reducer module:
  `useCreateBoard` (Home and Board-not-found share the create machine) and `BoardPage`. The one
  piece of that machine worth testing apart from the rendering is the retry schedule, and it is
  exported for that: `boardCheckDelay(retry)` (1 s, 2 s, 4 s … capped at `RECONNECT_MAX_BACKOFF_MS`).
- **`PageNavigator`, not `Navigator`** — the DOM lib already exports that name, and shadowing it in
  a browser app is a trap for whoever writes the next hook in this file.
- **`SharePanel` lives in `src/client/share/`, not `board/`**: it is about the link, not the
  document, and `board/` is the stories 1–4 board with nothing new added to it.
- **The `/b/<id>` match is exact.** `/b/<id>/edit` is Board not found, not a board. The id segment
  is percent-decoded, and a segment with a malformed escape (`%E0%A4%A`) or with control or space
  characters in it is refused by `decodeSegment()` before anything is asked of the service (TC-19's
  "no request at all" is a property of the router, not of the page).
- **`/api/rooms/:id` with a malformed id answers 404 where story 3 answered 400**, per the design;
  `tests/integration/worker-routing.test.ts` was updated rather than left asserting a 400 that no
  longer exists.
- **`initialize()` and `exists()` are Durable Object RPC methods**, not HTTP routes inside the
  object. `BoardStore.existsReadOnly()` looks at `sqlite_master` first, so a probe of an address
  nobody issued cannot create tables — TC-06 and TC-09 assert that nothing was written afterwards.
  `migrate()` still creates the tables, and now runs from `initialize()` and lazily before the first
  `append()`.
- **`inject('load:meta')` moved from `migrate()` to `load()`.** Story 4's "refuses to load when it
  cannot read its own record" arms that fault and expects it during a _read_; with the inject in
  `migrate()` it fired during a step that test never reaches, and the test passed for the wrong
  reason.
- **`BoardStorage.open()` in story 4's integration tests calls `stub.initialize()`** instead of a
  bare `fetch()`: since this story a plain fetch to the room is refused (426 without an upgrade,
  404 for a board that does not exist), and nothing creates tables on a fetch any more.
- **`e2e:serve` passes `--var TEST_HOOKS:1`.** The `/__test/boards/:id/<action>` hooks are compiled
  out of the default build; the e2e server already needed them for story 4's corruption tests, which
  started their own `wrangler dev`, and now the shared server needs them too, because every test
  that navigates to an address has to be able to make the board behind it. Two hooks were added:
  `initialize` (the same RPC `POST /api/boards` makes) and `seed-legacy` (writes `updates` rows with
  no `created_at`, which is TC-31's board that predates links).
- **e2e helpers create the board they are about to open.** `openBoard`, `openBoardAt` and story 4's
  `RoomClient` path call `ensureBoard()` first, which is one POST to the test hook — the same
  `initialize()` RPC the real button makes, over the same route. Without it every story 1–4 test
  would land on Board not found, since each one invented its own board id and never registered it.
- **Two story 3/4 tests were opening boards that did not exist** and only worked because the room
  used to create whatever it was asked for: live-network's "a room that cannot be reached" and
  story 4's "big board open". Both now create the board first, and the first says so in a comment —
  a room that is down and a board that was never made are different answers, and the test is about
  the first one.
- **`room-client.ts` rejects with a message when `ErrorEvent.message` is empty.** A refused upgrade
  gives an error event whose message is `''`, so the failure line of a five-minute test was literally
  `''`. `||`, not `??`.

## Findings while testing the implementation

- **The Share panel closed itself in the act of opening, and only in a browser.** The panel closes
  on a click outside itself, listened for on the document. Opening replaced the Share button with a
  different tree, and the click that opened the panel was still on its way to the document: by the
  time the listener existed, its own button was gone, so the click that opened the panel was an
  outside click, and the panel vanished in the same millisecond. TC-26 found it; the component suite
  could not, because jsdom hands the event to the document before React has built anything. The
  first fix was a timestamp rule ("ignore a click that predates the panel"), which was wrong twice
  over: it is a race dressed up as a rule, and jsdom's `MouseEvent.timeStamp` is `Date.now()`-based
  while its `performance.now()` starts at 0, so the rule was inert exactly where the tests ran. The
  fix is structural: one tree always, `div.share` holding the button, the panel rendered inside it
  when open — the click that opens cannot be outside the thing it opened. The component test is now
  that invariant ("keeps the button it was opened by inside itself") rather than a stopwatch.
- **A state that passes is not a state you can look for afterwards.** TC-28's "Opening board…" is
  on screen for one frame before the first attempt fails, and `toBeVisible()` on it was a coin toss
  decided by machine load. The test now installs a `MutationObserver` with `addInitScript` that
  records every `data-testid` and every `[role="status"]` text from the first frame onwards, and
  asserts against what the page actually said. This is the same pile-up lesson as story 2's
  `badgeText`, seen from the other side: _either wait for a state to appear, or record it as it
  passes — do not go looking for it after it has gone._
- **nightly TC-30 (capacity soak) hangs, and hangs at HEAD too.** It failed twice here at
  `soakOps → noteIds → locator.evaluateAll`, so it was run from a clean worktree of the commit
  before this one: same call site, same 300 s timeout, nothing measured. It is the pile-up class
  already described above — the soak reads note ids with a locator, in a five-browser loop, while
  other people delete the notes under it. Not caused by this story and not fixed by it; it should
  be fixed in `tests/e2e/helpers/soak.ts` (read with `page.evaluate`, as `badgeText` was) in whatever
  story is next.
- **Firefox and WebKit still cannot start in this sandbox** — `browserType.launch` aborts
  (`SIGABRT`) before any test code runs, verified again on TC-27 and TC-29, which is the design's
  "also in firefox and webkit" line. Same finding as stories 1 and 2; the two tests are Chromium-green.
- **FR-4 is measured in TC-26** (click "New board" to an editable board: ~200 ms against a
  2 000 ms budget, logged and annotated, never asserted), and `openBoardAt` prints its own painted/
  live numbers under `VIDI6_TRACE=1`. Nothing in the suite fails because a duration was too long.

## Final test counts (story 5)

| Suite                      | Files | Tests                                                                                                                 |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | 11    | 158 (+ board id TC-04, router table incl. traversal and malformed escapes)                                            |
| `npm run test:component`   | 12    | 151 (+ HomePage 8, BoardPage 18, SharePanel 21; − story 3's routing tests, which the router unit suite covers better) |
| `npm run test:integration` | 9     | 144 (+ board-api 25: TC-05…TC-10, TC-12, TC-14, TC-15, TC-32)                                                         |
| `npm run test:e2e`         | 12    | 58 chromium (54 shared-server + 4 persistence), incl. share.spec TC-26…TC-29, TC-31                                   |

`npm run build`, `npm run build:test` and `npm run typecheck` are clean. The nightly project runs
`idle-stability` green and `capacity-soak` into the pre-existing hang above.

# Story 7: select, move, resize and delete several objects at once

## Contract deviations (all deliberate)

- **`snapshot()` returns objects, not notes.** The board's read function used to return
  `readonly StickySnapshot[]`; it returns `readonly ObjectSnapshot[]`, because after the registry a
  board can hold things that are not sticky notes and a read that silently dropped them would be a
  read that lies. Story 3's and story 4's integration helpers are the only tests touched, and only
  where their own signature promises notes: they now end in `.filter(isStickySnapshot)`. Not one
  assertion in them changed.
- **`App.tsx` is not modified.** The design's file table puts the overlay, the bar and the keys in
  `App.tsx`; they are wired in `Board.tsx`, which is the component that owns the document, the
  camera and the selection. `App.tsx` is routing and a share panel, and it has no business knowing
  about resize handles.
- **`EndEditNext` does not exist.** The design mentions a selection action that closes the text
  editor and selects something next. Closing the editor and changing the selection are two
  decisions, and story 7 does not need the second one: by the time an editor closes, the selection
  is already whatever the pointer put it at. `StickyTextEditor`'s `onEnd()` takes nothing, and
  `useSelection.endEdit()` takes nothing. If a later story wants "select the next object", it is a
  new action with its own name.
- **`edit` does not collapse a selection.** `{ type: 'edit', id }` puts that object in the selection
  if it is not in it, and leaves a group of five a group of five. Enter on a selected note opens
  that note's text; it does not throw away the four objects selected alongside it. `Enter` only
  opens a text editor when exactly one object is selected (`selectionOnlyId`), so the group case is
  refused where it is cheap to refuse it rather than in the editor.
- **`registerObjectType` also declares the type to the model.** One registry, one source of truth:
  `board-model` cannot be told about a type by a different call than the one that gives the client a
  component for it, or the two lists drift and an object with a component stops being selectable.
  A "type the board does not know" test therefore has to use a type that was never registered.
- **Three things in geometry beyond the design's list.** `rectContainsPoint` (a point inside a
  rectangle — the existing `rectContains` rejects zero-area boxes, which is right for "is this box
  fully inside that one" and wrong for a pointer hit test); `scaleRect` (the box a handle's scale
  describes, which is what `resizeRect` was being asked twice, wrongly); and the fix to
  `scaleWithin`, which moved children by the box's *starting* origin instead of its ending one — so
  a drag of the west handle moved the notes without scaling them. Both are exported, both are
  unit-tested, and nothing in them knows what a sticky note is.
- **`useTransformGesture` is given the snapshot as an option named `snapshot`**, which shadows
  `board-model`'s `snapshot()`; inside that file the model's function is imported as
  `readSnapshot`. A name collision is a small cost for a hook that reads the board rather than
  reaching for a document of its own.

## Findings while testing the implementation

- **Start rectangles are recorded when the pointer goes down, not when the drag passes the
  threshold.** The design says both: its sequence diagram records them at `pointerdown`, its prose
  says "at threshold crossing". The diagram is the one that can be right. Two people pressing the
  same note and both dragging means the first one's writes arrive while the second one is still
  pressing; if the second measures its movement from rectangles read at threshold-crossing, it
  measures from a board the first person already moved, and its own absolute writes put the note
  somewhere that depends on network timing. Story 4's TC-24 (two people drag the same note, one
  note, both boards) is the test that shows this: it is deterministic with a press-time baseline and
  fails with a threshold-time one. Absolute writes only converge if everybody computes from a
  position they all agree is where they started.
- **A proportion-locked object locks the whole drag.** `aspect = event.shiftKey || any selected
  object keeps its proportions`. When the sizes stop, the two rules differ: shrinking takes
  `max(allowed.x, allowed.y)` so that both objects reach their minimum, growing takes
  `min(...)` so that neither passes its maximum. Taking one scale for all objects and one box for
  all objects is what makes a group resize one number rather than a negotiation.
- **Shift-pressing a second object in the middle of a drag is not a thing a mouse does**, and the
  first version of TC-26 did it anyway (press A, shift-press B with the same pointer, drag). It
  only passed because the gesture read the selection at the wrong moment. The test now does what a
  person does — click A, Shift-click B, then press and drag — and asserts the middle click produced
  no gesture at all, which is a rule worth having written down: selecting is not transforming.
- **E2E: a test that moves things by screen coordinates has to put every window at the same zoom
  before it makes the things.** TC-36 places notes by where they are seen, at five different
  windows; made at zoom 1, they land outside the view of a window at zoom 0.5, and the assertion
  about where a note ended up becomes a test of the camera. All five windows are set to the same
  scale before the first note is created, and the expected positions are computed from the camera
  each page is actually rendering.
- **E2E: notes cannot be made underneath the interface.** The toolbar, the zoom controls, the share
  button and now the selection bar are fixed over the board. A double-click that lands on one of
  them makes no note, and the test waits for a note forever. The spots a test uses are chosen to be
  clear of them, and the failure mode is written at the point where the spots are declared.
- **E2E: compare the boards before you compare the pages.** `expectSameBoard` has to run before
  per-note position assertions; reading another person's page while somebody is still dragging
  measures the network, not the board, and a stale read of a page that has since caught up looks
  exactly like a lost update.
- **`npm run e2e:serve` builds once, and Playwright will reuse it.** `webServer.reuseExistingServer`
  is on, so a `wrangler dev` left running from an earlier command answers the next
  `npx playwright test` with the build it made at startup. Source changes are invisible. This is how
  a real fix appeared to be a flake. Use a fresh `VIDI6_E2E_PORT` (the range allows it) or stop the
  old server; a "the old server cannot be killed" sandbox makes the fresh port the easier half.
- **The nightly soak (TC-30) does not finish on this machine, and did not finish before this story
  either.** Run from a clean worktree of HEAD, on the same seed, it fails at the same call site at
  300 s; given 900 s it still does not get through the soak's own 60-second loop. Story 5's notes
  blamed the read: that is wrong, and worth correcting here. `locator.evaluateAll` does not wait for
  a match — measured directly, it returned zero elements in 9 ms on a page with nothing matching —
  so `noteIds` is not "waiting forever" in the gap between the last note going and the next one
  arriving; the trace is only where the clock ran out. What is left as the explanation is the app:
  every note is a component that re-renders when the document changes, five windows do that while
  five people write continuously, and the main threads stop answering long before the loop's wall
  clock is spent. Neither this story nor its predecessor caused it, and fixing it is a rendering
  job (a note that subscribes to its own slice of the document, or a board that virtualises what it
  draws), which belongs with the nightly suite that found it. Per-commit e2e is 60 chromium tests
  plus 4 persistence ones, all green.
- **Firefox and WebKit still cannot start in this sandbox** (`browserType.launch` fails; WebKit
  aborts with `SIGABRT` before any test code runs). Re-measured on TC-32, which the design asks for
  in chromium, firefox and webkit; it is chromium-green and cannot run otherwise here.

## Final test counts (story 7)

| Suite                      | Files | Tests                                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | 15    | 286 (+ geometry 51, group operations 33, registry, selection reducer; TC-01…TC-15)                               |
| `npm run test:component`   | 16    | 212 (+ multi-select 14, marquee 8, group transform 19, keyboard 20; TC-16…TC-31)                                 |
| `npm run test:integration` | 9     | 144 (unchanged; five helper call sites now filter the widened `snapshot()` down to notes)                        |
| `npm run test:e2e`         | 14    | 64 of 66 green: 60 chromium (incl. TC-32…TC-36), 4 persistence, nightly `idle-stability`; nightly `capacity-soak` is the pre-existing hang above |

`npm run build`, `npm run build:test` and `npm run typecheck` are clean.

# Story 8: undo and redo my own changes without undoing anyone else's

## Contract deviations (all deliberate)

- **`App.tsx` is not modified**, for the third story running. The design's file table puts the
  `UndoManager` in `App.tsx`; the controller is created in `Board.tsx`, next to the document it is
  attached to — story 5's split made `App.tsx` routing plus a share panel, and it does not have a
  `Y.Doc` to hand.
- **`createUndo` wraps `Y.UndoManager`; it does not subclass it or reimplement it.** `undo()` and
  `redo()` return a boolean — was there a step to take? — because the caller has nothing else to
  report to the person, and `boundary()` is `stopCapturing()` under the name that says what it is
  for. `canUndo()`/`canRedo()` stay methods, as the design's interface writes them.
- **`useUndo(controller, canEdit)` reports `canUndo: false` on a board that cannot be edited**, even
  with a full stack underneath. The stack is not wrong, and it is not the person's to spend either;
  a greyed button tells the truth and an enabled one that does nothing does not. The history is
  neither cleared nor reset by the lock — it is only unshown, and comes back with the connection.
- **Step boundaries are called by the thing that knows a step has ended** — a drag at both ends, a
  text editor at both ends, a colour pick and a delete at both ends — and the controller's capture
  window is left to do the one job it is good at: making a burst of keystrokes one step. There is no
  timer in the controller, no "wait and see if more typing came", nothing that has to be tuned.
- **`ObjectProps` grew an optional `undo`** instead of an undo context. An object rendered outside a
  board — a test, a future thumbnail — has no history, and `undo?.boundary()` says so at the place
  where it is true rather than throwing at the place where it is not.
- **A board that can be edited answers Ctrl+Z even when its history is empty.** `useBoardKeys` calls
  `preventDefault()` whenever `canEdit` and a controller are present, and then does nothing if there
  is nothing to undo. The alternative — letting the chord through when the stack is empty — hands the
  keystroke to the browser, which is a second undo of a different thing altogether.
- **The chord predicates are structural** (`ChordKeys`: `key`, `ctrlKey`, `metaKey`, `shiftKey`,
  `altKey`). A DOM `KeyboardEvent` and React's synthetic one both satisfy them, which is what lets
  the board's keys and the note's text editor agree on what Ctrl+Shift+Z means without either
  importing the other.

## Findings while testing the implementation

- **`lib0/time`'s `getUnixTime` is `Date.now` bound at module load.** Neither `vi.useFakeTimers()`
  nor replacing `Date.now` moves a Yjs capture window once `yjs` has been imported — the timer the
  capture test wanted to fast-forward cannot be fast-forwarded. TC-12 and TC-13 therefore use a
  short window (60 ms) and real timers, and say in the file why they do; a test that pretended to
  control that clock would have been a test of the fake, not of the capture.
- **Yjs walks past a step it cannot apply, and that is behaviour a test can easily mistake for a
  bug.** When the object a step would move has been deleted by somebody else, `undo()` pops the dead
  step *and applies the step under it* in the same press. Nothing is resurrected — that is the half
  that matters, `redoItem` will not write into an object somebody deleted — but the person sees the
  change underneath go back too. TC-23's e2e fixture was rewritten around this: the six notes are
  Raj's, not Mia's, so Mia's history holds exactly the one dead step. Written the other way round it
  asserted about however many notes Mia had made, and about yjs's stack-walking rather than about
  the promise the story makes.
- **The boundary goes in *before* the first write of a gesture, not after it starts.** In
  `useTransformGesture` the threshold check is followed by a bring-to-front and then by the drag; the
  first version called `onGestureStart` after `startDrag()` had returned, which closed a capture
  window that the restack had already opened — and a colour click made a second ago joined the drag.
  Same lesson as story 7's press-time rectangles, from the other side: a step begins where the first
  write of it is.
- **The text editor closes its step on the way out as well as on the way in**, because not every way
  out is the person's own: a colleague deleting the note, a board clearing the selection and an
  object type losing its registration all unmount an editor that is still open. A step left open at
  that point takes the next thing the person does into a step that belongs to the note that is gone.
- **Compare the boards before you compare the pages** — and this is the story that tripped on it
  again. TC-24 read another person's page for a position while that person's own browser had already
  undone the move, and reported an undo that had "not arrived". `expectSameBoard` first, positions
  afterwards; and the agreement is not a courtesy here, it is the proof — a person's own browser
  always holds their own undo, so five screens agreeing means all five undos reached all five.
- **Firefox and WebKit still cannot start in this sandbox** (`SIGABRT` before any test code runs).
  The design's "chromium, firefox, webkit" line for the undo chord is chromium-green here.
- **Nightly TC-30 (capacity soak) hangs exactly as it did before this story**, at the same call site
  and the same 300 s; stories 5 and 7 both measured it from a clean worktree of HEAD and found the
  same, and the cause there is a board that re-renders every note on every document change. Per
  commit, e2e is 63 chromium tests, 4 persistence ones and nightly `idle-stability`, all green.

## Final test counts (story 8)

| Suite                      | Files | Tests                                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | 17    | 301 (+ undo history 11 with a simulated peer: TC-01…TC-11; + capture window 4: TC-12, TC-13 and their bounds)     |
| `npm run test:component`   | 18    | 237 (+ gesture/typing/colour/delete boundaries 9: TC-14…TC-17; + shortcuts, buttons and the edit lock 16: TC-18…TC-21) |
| `npm run test:integration` | 9     | 144 (unchanged — undo is a client-side view of the document, and the room never hears about it)                   |
| `npm run test:e2e`         | 15    | 68 of 69 green: 63 chromium (incl. TC-22…TC-24), 4 persistence, nightly `idle-stability`; nightly `capacity-soak` is the pre-existing hang above |

`npm run build`, `npm run build:test` and `npm run typecheck` are clean.

# Story 9: Write free text anywhere on the board

## Contract deviations (all deliberate)

- **`ObjectProps.onEndEdit` takes an optional owner id** (`onEndEdit(owner?: string)`), where story 7's
  contract is `onEndEdit()`. The reason is a single pointer press that closes one object's editor and
  opens another's: the board's reducer chains the actions of one event, so by the time the closing
  editor's `onEnd` runs, the selection already holds the object the same press just opened, and
  "close the open editor" closes the editor this press opened. `endEdit(owner)` refuses the close when
  a *different* object's editor is open, and every object now passes its own id
  (`StickyNote` and `TextObject` both do). `useSelection`'s `'edit'` action carries the same optional
  owner on the way back.
- **`TextObject` is `ObjectProps<TextSnapshot>`, not `ObjectProps & { note: TextSnapshot }`**:
  `ObjectProps` was already generic in the snapshot it carries, and the registry passes the snapshot it
  read. A `note` prop on a text object would be a name that lies.
- **`TextEditor`'s props grew past the contract** with the things two owners actually need to disagree
  about: `label` (the textarea's accessible name), `className`, `testId` (prefix for
  `<testId>-editor` / `<testId>-counter`, because a note and a heading open on the same screen are two
  boxes a test has to tell apart), `counterFrom` (left out means no counter — a note counts down towards
  1 000 because a nearly-full note looks full; a heading has nothing that counts down), and `onInput()`,
  which is where a text object measures its own box. `onEnd(next: TextEditorExit)` keeps the design's
  union but the value now answers "is there anything left in here", which is the only thing the editor
  knows at that moment; a sticky note ignores it, because a note left empty is still a note.
- **`useTool` returns a named `ToolControls`** (`{ tool, setTool }`) — the contract's two members, with
  the interface named because `Board` passes it down and `BoardViewport` reads it. `setTool('text')` on
  a board that cannot be written to is refused rather than entered and failed in.
- **`createText` stores a box straight away**, from `estimatedTextBox()` (the shared
  `TEXT_GLYPH_WIDTH_RATIO` estimate, floor of 1 unit), where the contract's contract is "an empty text
  object is created". The board draws objects from their stored `width`/`height`; an object created with
  no box at all is an object that draws as nothing until somebody measures it, and the client that
  creates it is not always the client that measures it. `estimatedTextBox` is exported and unit-tested,
  and the first local measurement replaces it — the estimate is what a box looks like before it has a
  measurement, not instead of one.
- **`createdBy` is `boardIdentity().name`, not `identity.id`.** The design's `createText(point,
  identity.id)` assumes story 6's per-participant identity; what this build has is the name and colour
  `identity.ts` keeps in `sessionStorage`, and `name` is what the board already stores on a sticky note.
- **`isTypingTarget` moved from `StickyTextEditor.tsx` to `TextEditor.tsx`** (re-exported from the old
  file, unchanged), because it describes the generalised editor and `StickyTextEditor.tsx` is now a
  configuration of it. Story 2's note pointing at the old file stands as history; the definition is in
  one place.
- **`SelectionBar` answers for one text object**, which story 7 explicitly did not do (`selected.length
  < MIN_GROUP (2)` returned null). A heading's size is a property of one object, and the design asks for
  S/M/L/XL buttons on a single selected text; the bar keeps its two-object minimum for everything else
  and renders `TextToolbar` when the one thing selected is a text object.
- **`useTextBoxSync` is three exports, not one hook**: `measureTextBox(doc, id, measure)` (pure read of
  the box the content asks for), `remeasureTextBox(doc, id, measure)` (measure and store), and the hook
  that hands `TextObject` a stable `remeasureAfterLocalChange`. The two functions exist so a component
  test can assert "the write happened, and happened only after a local change" against a real `Y.Doc`
  without rendering anything, which is exactly what TC-12 and TC-13 are.
- **A side-handle drag writes text width conditionally.** Position is always written; `width` is written
  only when the object is in `fixed` mode or it is the only object and the only *kind* in the selection
  (`session.solo`); `height` is always re-measured from the new width. The design says "a horizontal
  handle drag on a single text calls `setTextWidthFixed`" and "in mixed selections fixed widths scale" —
  an `auto` text in a mixed group is the case neither sentence covers, and the answer taken is: a group
  drag is about the group, and the heading's own width stays the content's business unless the person
  gave the text a width of their own first.
- **`layoutText` adds no padding.** The contract's width is `min(longest line,
  TEXT_MAX_AUTO_WIDTH_WORLD)`; the note's inner padding (`STICKY_PADDING_WORLD`) is a note's business —
  free text has no box to sit inside, so its measured width is its longest line and nothing else.
- **The tool component test is `tests/component/TextTool.test.tsx`, not `Tool.test.tsx`**, next to
  `TextObject.test.tsx` and `TextBoxSync.test.tsx`.

## Findings while testing the implementation

- **React 19 delegates from the root container, so the Text tool has to claim its clicks above that.**
  The first version put a capture-phase `pointerdown` listener on the viewport element and
  `stopPropagation()`ed when the tool was lit; in a real browser the click still reached
  `BoardViewport`'s own `onClick`, which cleared the selection and closed the editor that had just been
  opened. The viewport element is a *descendant* of the container React 19 attaches to, so a listener
  there runs after React's. The claim listeners (pointerdown, pointerup, click) go on `document`, which
  is an ancestor of everything, and `stopPropagation()` there lands before React's dispatch. `click` is
  claimed as well as `pointerup`, because stopping the pointer-up does not stop the click event that
  follows it.
- **The second half of a double-click needs a guard that is a time, not a state.** Placing text returns
  the tool to Select — so the down-up of a double-click that made a heading is followed, a frame later,
  by a Select-tool press at the same point, which starts a marquee and selects the object the same
  gesture just made. The guard is the position and the moment of the last placement (`placedRef`): a
  press within `DRAG_THRESHOLD_PX` of it and inside `DOUBLE_CLICK_WINDOW_MS` (500 ms) is the tail of the
  placement and is swallowed with `stopImmediatePropagation()`, while a press elsewhere passes through
  normally. While the tool is still lit the claim is only `stopPropagation()`, so the document's other
  handlers keep theirs; the difference is in `claim(event, guard)` and it is the difference between
  ending a gesture and cancelling somebody else's.
- **`createTextAt` clears the selection before it opens the new object's editor.** Story 7's `'edit'`
  action *adds* the id to the selection and leaves a group a group, which is right for Enter on a
  selected note and wrong for a click on empty board: without the `clear()` the new heading joined
  whatever had been selected before, and the toolbar that appeared was the group's.
- **`isEmptyText` counts characters, not visible ones.** Whitespace-only text is text: a heading left
  with three spaces in it stays on the board. The PRD's "contains no characters" is the rule, and a space
  is a character. TC-20 asserts the two halves of that (empty goes, `"   "` stays) because the convenient
  implementation — `trim()` — is the one that loses somebody's deliberate blank line.
- **E2E: find your own object by the editor you opened, not by diffing the board.** `placeText` used to
  note the text ids, click, and expect exactly one new id. With five people each placing a heading at
  the same moment it found four, and the ones it found were other people's. The object this page made is
  the object this page has open for writing: `.text-object[data-interaction="editing"]` answers in one
  read and is true whether or not the board is shared, and it additionally proves the tool switched back
  and the editor opened.
- **E2E: wait for the words, not for the count.** TC-30 waited for `textCount(page) === 5` and compared
  the five screens; it failed with five objects on every screen and each screen holding one person's
  heading. The count was already satisfied the moment the objects were *created* — it was the typing
  that had not arrived. The wait is now on the content (`every heading string appears in the page's text
  snapshot`) before any cross-screen comparison. A board that has the objects and not the text is
  precisely the state this test exists to catch, and a count cannot see it.
- **A component test cannot predict a scale, so it stops trying.** TC-23 (a group drag moves and scales
  a heading, keeps a note's aspect) is asserted relationally: read the note's own growth as the group's
  scale (`scale = noteNow.width / noteWas.width`) and check the heading's offset from the note scaled by
  that same number. The alternative is a test that recomputes `allowedScale` → `clampScale` →
  aspect-reconciliation by hand, which is a copy of the implementation and breaks whenever the clamps
  are tuned — and `allowedScale` takes `min(allowed.x, allowed.y)` when growing, which is exactly the
  kind of detail a test should not have to know.
- **jsdom does not measure text**, so `createCanvasMeasurer` falls back to `estimateTextWidth` there
  (once per test file the "Not implemented" note appears; `getContext` returns null and the estimate is
  used, which is the contract's "measurer unavailable" path, not an error). Anything the story's promises
  say about *rendered* lines — wrapping, a box that is a whole number of lines, a caption that fits — is
  asserted in e2e against real Chromium layout; the component suite asserts stored boxes, update counts
  and what the DOM says.
- **The keyboard ring of the board grew by two stops and a bounded Tab walk noticed.** `sticky-delete`'s
  "Tab reaches a note" walks the focus ring until it lands on the note, with a bound of 16 that had one
  stop of slack. The toolbar leads with two tool buttons now, so the ring is seventeen stops before the
  note comes round again (measured: note, six colours, delete, tool-select, tool-text, sticky, undo,
  zoom-out, zoom-in, reset, share, body). The bound is 24 and the comment names the stops; the promise
  under test is that a note is reachable by Tab at all, not what the chrome in front of it counts.
- **`fixture.create(x, y)` centres the note**, it does not place its top-left: `createSticky` subtracts
  `STICKY_SIZE_WORLD / 2` internally. A test that reads it as a top-left reasons about an object that is
  100 units away from where the board put it, which is how one of the new component tests spent its time
  failing on a position that was correct.
- **`undo-capture` TC-13 is a load flake, not a story 9 one.** It uses real timers with 60 ms windows
  (the capture clock is `lib0/time`'s bound `Date.now`, which no fake can move — story 8's finding) and
  fails when four vitest workers share the machine; it passes in isolation and it passes in a full run
  on a quiet machine. Nothing in story 9 touches it.
- **Firefox and WebKit still cannot start in this sandbox** (`browserType.launch` aborts before test
  code runs), so TC-26's "also in firefox and webkit" line is chromium-only here — the same finding as
  stories 1, 2, 5, 7 and 8.
- **Nightly `capacity-soak` (TC-30) still does not finish**, at the same call site and the same 300 s.
  Measured again from a clean worktree of HEAD this story, with the same failure, so it is the
  render-everything-on-every-change cost stories 5 and 7 already wrote up and not something text added.
  Nightly `idle-stability` is green; per-commit e2e is 69 chromium tests plus 4 persistence ones.

## Final test counts (story 9)

| Suite                      | Files | Tests                                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | 19    | 364 (+ text model 39: TC-01…TC-06 and the schema's edges; + text layout 24: TC-07…TC-11, TC-32 with a fake measurer) |
| `npm run test:component`   | 21    | 271 (+ box sync 7: TC-12, TC-13; + tool 12: TC-14…TC-18; + text objects 15: TC-19…TC-25)                           |
| `npm run test:integration` | 9     | 144 (unchanged — a text object is a document change like any other, and the room never hears that it is text)     |
| `npm run test:e2e`         | 16    | 73 of 74 green: 69 chromium (incl. TC-26…TC-31), 4 persistence, nightly `idle-stability`; nightly `capacity-soak` is the pre-existing hang above |

`npm run build`, `npm run build:test`, `npm run typecheck` (client and worker) and `npm run test` are clean.

## Contract deviations (all deliberate)

Story 10 — shapes, and the arrows that hold two of them.

- **`shapeRect(rect, at, square)` is what decides a click from a drag**, not the tool. The design left the
  question where it usually is left; the answer here is "a box that fails to reach `SHAPE_MIN_SIZE_WORLD`
  (20) on either axis is a click, and becomes the standard 160 × 160 centred on the point that was pressed".
  Putting it in the model is what lets the *preview* be honest — the tool draws the box `shapeRect` will
  write, so what a person watches while the button is down is the rectangle that appears when it comes up,
  including the standard size. A tool that decided "is this a click" by distance and a model that decided
  it by size would be two answers, and the preview would be a promise the release breaks.
- **`createShape` returns `string | null`** — `null` for a kind nobody draws, a rect made of `NaN`, or a
  point that isn't a point, with no transaction opened. The id comes back because the tool has to select
  the thing it made, and a tool that went looking for "the shape that just appeared" would be guessing.
- **`ShapeSnapshot` carries `text: string`** (the label's content, for the read-only snapshot) while the
  label itself lives in the entry as a `Y.Text` shared type. `snapshot()` reads one; the editor writes the
  other. `getShapeLabel` returns `Y.Text | undefined` rather than `| null`, to match how the rest of this
  codebase answers "is it there".
- **A shape's label is an HTML overlay, not a `foreignObject` inside the shape's SVG.** The geometry is SVG
  (`<rect>`, `<ellipse>`, `<polygon>`), the words are a positioned `div` on top of it. The design allowed
  either; `foreignObject` is the more faithful markup and the worse neighbour — text inside it is not laid
  out by jsdom at all, so every component test about wrapping would have to be an E2E test, and browsers
  still disagree about scrolling and focus inside it. The centring, the wrapping and the font are the same
  in either markup, and TC-24 measures them in the browser where markup stops being a preference.
- **`ConnectorSnapshot`, not `ConnectorSnap`**, for consistency with `ObjectSnapshot`/`ShapeSnapshot`.
- **A free endpoint is `{ kind: 'free', x, y }`**, not `{ kind: 'free', point: {x, y} }`: an endpoint is
  already a place-shaped thing and nesting a point inside it buys a second way to write the same pair.
- **`detachConnectorsTo(doc, deletedIds: readonly string[])`** takes an array. A `Set` at that boundary
  would be an optimisation on a list the caller has already built once.
- **A connector's `x`/`y`/`width`/`height` are derived, not stored facts.** `snapshot()` runs
  `deriveConnectorBoxes()`, which resolves both ends through the current boxes of the shapes it holds and
  writes the bounding box of the result. Width or height can legitimately be 0 (an arrow drawn dead
  horizontal or dead vertical), which is why the registry's hit test for a connector is a distance to its
  polyline and never a box. Chains (A→B→C) need the boxes of arrows that are themselves endpoints of
  nothing but are still read as boxes by nothing — the loop runs up to `connectors.length + 1` passes and
  leaves as soon as a pass changes nothing, which is also what makes a cycle survivable.
- **The registry's `hitTest` grew an optional third argument**, `context: HitContext` (`{ zoom, rects }`),
  and `hitTestObject`/`topmostObjectAt` pass it through. An arrow's hit test cannot be done in world units
  alone: the tolerance is six *screen* pixels, which is six divided by the zoom in world ones. Every other
  object ignores the argument. `BoardContext` (`camera`, `objects`, `rects`, `toWorld`) was added to
  `ObjectProps` for the same reason the connector's handle needs to know what is under the pointer.
- **`useTool` is gone; `useActiveTool` replaces it** (`git rm`'d). `ToolId` is the whole vocabulary of the
  toolbar including names this build does not implement (`sticky`, `pen`, `image`, `comment`): they are in
  the type and in `TOOL_SHORTCUTS` — so the key table is complete and a story that adds a pen adds a button
  and nothing else — and `BUILT_TOOLS` is what `setTool` will actually accept. `n` keeps its old behaviour:
  it is in the shortcut table and is answered before the generic branch, because it makes a note rather
  than switching a tool.
- **`Toolbar` takes one `onToolSelect(tool: ToolId)`** instead of a callback per tool, plus `tool`,
  `shapeKind` and `onShapeKindSelect`. Three no-arg callbacks was three ways to say the same sentence.
- **The Shape tool's kind buttons are derived from `SHAPE_KINDS`**, so a fourth kind is a config entry, and
  their `title` says only what the button does — the design's prose mentioned R/E/D letters, which are not
  in the design's own keyboard table and are not implemented. A tooltip that promises a shortcut that does
  not exist is a bug with better spelling.
- **Extra config, all in one place:** `SHAPE_LABEL_FONT_SIZE_WORLD` (20, same as `TEXT_SIZES.M`, so a label
  and a text object of the same size are the same size), `CONNECTOR_COLOR` (`#263238`, the same ink as a
  shape's label; this build has no arrow-colour UI), and the screen-pixel constants below.
- **The dots the Connector tool draws over a shape carry `data-hover-object-id`, not `data-object-id`.**
  They are not objects and were inflating the existing E2E `objectCount` helper — which is to say the board
  appeared to have grown shapes that were only ever hints. The helper was right to complain.

## Findings while testing the implementation

Story 10.

- **`expect(promise).toBe(x)` in Playwright compares the promise, not its answer.** It fails with
  `Received: Promise {}` — there is no implicit awaiting and no `.resolves` (that is a vitest habit).
  Two helpers were written that way and both were silent about it until they were used: the fix is
  `await expect.poll(() => toolOnScreen(page)).toBe(tool)` for an attribute read through `evaluate`, or the
  locator's own web-first matcher (`await expect(button).toHaveAttribute('aria-pressed', 'true')`) where
  there is a locator to hang it on. Reading into a local and asserting locally is the third way, and the
  only one that works inside a `whileDown` callback, which is a callback and not a test body.
- **The board's chrome owns its own clicks, and that cost an hour of thinking a shape was not being made.**
  The toolbar is `position: fixed` down the left edge, vertically centred — at 1280 × 800 it covers roughly
  x 16–150 and y 150–650 — and both drawing tools ignore a press on `button, textarea, input, select,
  [role="toolbar"]` on purpose (a lit Shape tool must not steal the click from the swatch a person is
  aiming at). So a fixture drag that *starts* at (120, 500) draws nothing, correctly, and the failure looks
  exactly like the tool being broken. Every fixture in `shapes.spec.ts` and `connectors.spec.ts` now draws
  clear of that column, and the specs say so.
- **A wrapped label is measured with a `Range`, not with the label's own box.** The label element is
  `inset: 0` inside the shape and centred with flexbox, so its `getBoundingClientRect()` is the *shape*:
  dividing its height by the line height says "six lines" at any width, which is how one assertion passed
  on a label that had not wrapped and then failed on one that had. `document.createRange()` over the
  label's contents, then `range.getClientRects()`, is one rectangle per line the words are actually drawn
  on — the number the PRD means by "it wrapped".
- **A shared type's observers run after the transaction they police has closed**, so a limit enforced in a
  model observer is always two updates (the write, then the cut) and always a second step in the history.
  That is why the label limit is a *backstop*: `TextEditor`'s `maxChars` clamp is the enforcement point and
  an ordinary keystroke is one transaction. The observer is there for writes that arrive by some other
  route, and it polices only local writes (`origin === null`, or `LOCAL_ORIGIN`) — a colleague's 600
  characters are their words and this client does not edit them down (TC-06). A `policing` flag keeps the
  cut from being a write it then has to police again.
- **Tool pointer ownership needs capture phase, and `stopPropagation` is the right stop, not
  `stopImmediatePropagation`.** Document-level capture listeners are what let a drag that begins on a note
  belong to the tool rather than to the note; `stopPropagation` keeps the event from ever reaching React's
  root listener, which is the whole of what "the board never sees it" means, while still letting another
  document-level capture listener run — specifically the open text editor's commit-on-press-outside handler,
  which is how a shape drawn while a label was being typed keeps the text that was in the box.
  `stopImmediatePropagation` silenced that editor commit, and the lost characters were the only symptom.
- **Stopping `pointerdown` does not stop the browser synthesising `dblclick`.** Two fast clicks with a
  drawing tool lit would otherwise open a text editor underneath the drag, so `BoardViewport`'s double-click
  handler has its own tool guard. Pointer events and the click events the browser manufactures from them
  are two systems and you have to be in both.
- **jsdom has no layout, so screen-pixel semantics are asserted in two halves in component tests.** An arrow
  you can click "six pixels from the ink" cannot be clicked at a distance in jsdom, because jsdom will not
  tell you where the ink is. The component test asserts the DOM-visible half (`data-stroke-width` on the
  hit line is `2 × 6 / zoom`) and the geometry half through `hitTestObject(snapshot, point, { zoom, rects })`
  directly; the browser half is TC-20 in E2E. Similar for wrapping: component tests assert the text and the
  box, E2E asserts the lines.
- **Coordinates in component tests are screen coordinates unless you say otherwise.** The default camera
  after `resetCamera` is `{ x: -640, y: -400, zoom: 1 }` and the app div sits at (0, 0) in jsdom, so world
  and screen differ by exactly (640, 400) — enough to write an assertion that is right about a board the
  test is not looking at. `screenOfWorld`/`worldAt` pairs in the test file keep the conversion in one place;
  `window.__vidi6.setCamera({ zoom })` is the way to test a zoomed board, with an `act` + frame afterwards.
- **The board's own test hook made the zoomed-hit-test test honest**: rather than reasoning about what six
  pixels at zoom 0.5 should be, the test sets the camera, reads `data-stroke-width` off the rendered arrow,
  and asserts the number is the tolerance divided by the zoom it just asked for.
- **Firefox and WebKit still cannot start in this sandbox** (`browserType.launch` aborts before test code
  runs), so this story's e2e is chromium-only — the same finding as stories 1, 2, 5, 7, 8 and 9. Nightly
  `capacity-soak` (TC-30) still does not finish, at the same call site and the same 300 s; nothing in this
  story is on its path.
- **Rebuilding the bundle underneath a running `wrangler dev` breaks e2e in a way that looks like a broken
  app.** The nightly `idle-stability` test failed with `getByTestId('app')` — element(s) not found, which is
  "the page is empty", not "the board is wrong". Cause: `wrangler dev` takes its static-asset manifest when
  it starts, and vite names every bundle by content hash. `index.html` is read afresh, so it pointed at the
  new hash; the manifest did not know that name, the request fell through to the SPA fallback, and the
  module came back as `200 OK` / `text/html`, which the browser refuses for a module script — so nothing
  booted. Verified with `curl -I`: the hash the server knows answers `text/javascript`, the one it does not
  answers `text/html`. Nothing to do with story 10, and it went green again once the bundle it was serving
  was the one the server had seen. Two rules: if an e2e run says the whole app is missing, look at `dist`
  and at the server before looking at the code; and a server started before a rebuild is a server that has
  to be restarted. Which brings the environment finding for this story: **a background `wrangler dev` cannot
  be stopped from here** — `pkill`/`ps` report no such process (the sandbox cannot see it) while the port
  goes on answering, and Playwright's `reuseExistingServer` will hand that same frozen-manifest server to
  the next run. Either leave `dist` exactly as the server saw it, as this session ended up doing, or point
  the next run at another port in 20784–20799 with `VIDI6_E2E_PORT`.

## Final test counts (story 10)

| Suite                      | Files | Tests                                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`        | 21    | 451 (+ shape model 31: TC-01…TC-06 and the label guard's edges; + connector model 56: TC-07…TC-14, TC-29 and the geometry under zoom) |
| `npm run test:component`   | 23    | 314 (+ shape tool/object/toolbar 21: TC-15…TC-17, TC-28; + connector tool/object 22: TC-18…TC-22)                   |
| `npm run test:integration` | 9     | 144 (unchanged — a shape and an arrow are document changes like any other, and the room never hears which they are) |
| `npm run test:e2e`         | 25    | 79 of 80 green: 75 chromium (incl. TC-23…TC-27), 4 persistence, nightly `idle-stability`; nightly `capacity-soak` is the pre-existing hang above |

`npm run build`, `npm run build:test`, `npm run typecheck` (client and worker) and `npm run test` are clean.
