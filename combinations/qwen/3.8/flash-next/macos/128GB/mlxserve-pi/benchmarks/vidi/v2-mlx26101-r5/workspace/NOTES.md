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
