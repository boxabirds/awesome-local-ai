# Story 1 notes: deviations, blocked items, things not covered

## Deviations from `design.md` (and why)

1. **`App.tsx` owns `useCamera`, `BoardViewport` reads it from context.**
   Design shows `BoardViewport` owning input handling *and* `App.tsx` wiring `ZoomControls` to
   `useCamera`. Both components need the *same* camera, so `App.tsx` calls `useCamera` once and
   publishes the controller through `BoardControllerContext` (`src/client/canvas/useCamera.ts`,
   `useBoardController()`). `BoardViewport` keeps its designed prop signature
   (`{ children?: ReactNode }`, children go in the world layer) and consumes the controller from
   context. Net effect on behaviour and on every test case is nil; it just removes the duplicate
   camera instance the literal reading of the design would require.

2. **Viewport measurement lives in `App.tsx` (`useViewportSize`).**
   Design says "Viewport size from a `ResizeObserver`" inside the viewport/hook. `App.tsx` measures
   the board element and passes the size into `useCamera`, because `App` owns the hook (see 1). A
   `ResizeObserver` is used when available, with a `window resize` fallback; jsdom has neither, which
   is why component tests pass a fixed size through the harness.

3. **Keyboard shortcuts are bound on `window`, not on a focused board element.**
   Design says the shortcuts work "while the board is focused". The board is the only thing on the
   page in story 1, so the handler is a `window` `keydown` listener that ignores events whose target
   is an input/textarea/contenteditable (`isTypingTarget`) and only handles Ctrl/Cmd + `=`, `-`, `0`
   with `preventDefault()`. TC-18/TC-18b cover the positive and negative cases.

4. **Extra `data-*` attributes for testability.**
   The board exposes `data-board-surface` (`viewport`, `grid`, `world`), `data-panning`, `data-zoom`,
   `data-grid-size`, `data-grid-offset-x/y` and `data-transform` on the world layer, plus
   `data-vidi6-overlay` on controls/hint. Those exist so component and e2e tests can assert grid and
   world geometry without depending on computed CSS, and so overlays can be excluded from board
   gestures. The visual dot grid itself is a CSS `radial-gradient` driven by the same numbers.

5. **Camera maths is immutable and identity-preserving.**
   `zoomAt`, `panBy`, `zoomStep` and `resetCamera` return the *same object* when nothing changes
   (e.g. zooming out at `ZOOM_MIN`). The `hasNavigated` latch in `useCamera` relies on that identity
   check so a click without movement, or a no-op zoom at a limit, does not dismiss the hint (TC-29).

6. **Test-only hook is build-gated.**
   `window.__vidi6` (`src/client/canvas/testHooks.ts`) is installed only when Vite runs with
   `--mode test` (`npm run build:test`). `npm run build` output contains no `__vidi6` string —
   verified by grepping the built bundle. e2e uses `build:test` through the Playwright `webServer`.

7. **`wrangler.jsonc` is assets-only for now.**
   Wrangler 4 rejects a `binding` without a Worker entry (`Cannot use assets with a binding in an
   assets-only Worker`) and rejects `send_metrics: "off"` (must be a boolean), so the config is
   `{ assets: { directory: "./dist/client" } }` with `send_metrics: false` and
   `observability.enabled: false`. The Worker entry (Durable Objects) arrives in story 3.

8. **Wheel `deltaMode` conversion constants.**
   The PRD requires line/page delta conversion but gives no page sizes, so `WHEEL_LINE_DELTA_PX = 16`
   and `WHEEL_PAGE_DELTA_PX = 800` live in `src/shared/config.ts` (TC-15b asserts the conversion).

## Blocked

- ~~**WebKit e2e project.**~~ **Resolved in story 2.** WebKit looked unusable because a plain
  `ldd` on `libWPEWebKit-2.0.so.1` / `libwebkitgtk-6.0.so.4` reports `libsoup-3.0.so.0`,
  `libjxl.so.0.8`, `libavif.so.13` and `libbacktrace.so.0` as "not found" — those libraries are
  shipped inside the Playwright build under `minibrowser-*/sys/lib` and are only on the loader path
  when Playwright launches the browser. `librariesResolve()` in `playwright.config.ts` now runs
  `ldd` with those directories on `LD_LIBRARY_PATH`, so the WebKit project is enabled and runs.
  The detection still drops a project whose libraries are genuinely missing instead of failing the
  whole suite.
- **Chromium had to be located, not installed.** `npx playwright install chromium` fails here: the
  Chrome for Testing download returns HTTP 403 from `cdn.playwright.dev` through the proxy. A Chrome
  for Testing build already on the machine is used instead
  (`~/.cache/vidi-agent-ms-playwright/chromium-1243/chrome-linux64/chrome`), selected by
  `chromiumExecutable()` in `playwright.config.ts` (override with `VIDI6_CHROMIUM_PATH`).
- **Result:** e2e runs in Chromium, Firefox and WebKit (story 1: 18 tests, all passing).

## Not covered (by design or by environment)

- **TC-33** — keyboard shortcuts while focus is in the browser chrome: the design marks this as not
  testable in-page; no test exists, matching the spec's "documented as not covered".
- **Safari pinch in e2e** — Playwright cannot synthesise `gesturestart/gesturechange`; the handler is
  covered by TC-17 in component tests, per the strategy's "Not covered" note.
- **Touch/trackpad two-finger pinch on non-Safari browsers** — expressed as Ctrl/Cmd+wheel (TC-16,
  TC-24); no touch-emulation e2e in story 1.
- **Persistence of the hint** — story 1 says the hint is not persisted; it reappears on reload
  (component test re-mounts and asserts it is visible again).

## Useful facts for the next story

- Ports in use: 20368 (`wrangler dev`, e2e), 20369 (wrangler inspector), 20370 (`vite dev`),
  20371 (`vite preview`). Nothing else is bound.
- `npm run test` = unit + component + e2e. `npm run build:test` is what e2e serves; a plain
  `npm run build` never includes the test hook.
- Board input state updates land on the next animation frame (rAF coalescing in `useCamera`), so e2e
  assertions must poll rather than read once. `tests/e2e/helpers/board.ts` provides `expectCentre`,
  `expectCamera`, `settle` and `clickSettled` (a click that tolerates the control disabling itself at
  a zoom limit) for exactly that reason.
- Sticky notes (story 2) should be rendered as children of `BoardViewport` — they land in the world
  layer, which is already `pointer-events: none` for gestures; if notes need their own pointer
  handling, that exclusion logic (board gesture vs object interaction) is where story 2 will hook in.

---

# Story 2 notes: sticky notes

## Deviations from `design.md` (and why)

1. **Notes are rendered in a stable DOM order; `z-index` carries the stacking order.**
   The design has `bringToFront` run at drag start so the dragged note is drawn above everything it
   overlaps. If the notes were painted in `z` order, `bringToFront` mid-drag would re-insert the
   dragged element, and Chromium/Firefox end a pointer capture when the capturing node leaves the
   document: the drag stopped silently at the threshold (found by the e2e drag tests). DOM order is
   now creation order (`createdAt`, then `id`) and each note sets `style.zIndex = note.z`, which
   gives exactly the same painting. `snapshot()` still returns notes sorted by `z` as specified, and
   TC-32 asserts the stacking with `document.elementFromPoint` in a real browser.
2. **A live drag re-takes pointer capture when it loses it.**
   `StickyNote` calls `setPointerCapture` again if `lostpointercapture` fires while a drag is in
   flight and the note is still in the document (it can also happen from a remote `z` change in
   story 3). A capture the browser drops for real still ends the drag and keeps the last applied
   position (TC-21).
3. **`STICKY_TEXT_PADDING_WORLD = 12` was added to `src/shared/config.ts`.**
   The design fixes the note's size and font bounds but not the text inset; the same number has to
   drive both the CSS inset and the fit measurement, so it is a named setting passed to CSS as
   `--sticky-text-padding` instead of being hard-coded twice.
4. **`fitFontSize` leaves the measure element at the size it settled on.**
   The design describes the search but not the restore; restoring the previous font size left the
   hidden measure element disagreeing with the inline style React renders, so the next measurement
   started from the wrong size.
5. **The measure element is `height: auto`, `visibility: hidden`.**
   A fixed-height element reports its own height as `scrollHeight`, which hides the overflow the fit
   search exists to find.
6. **The editor writes on React `onChange` and guards IME composition.**
   React's `onChange` is the native `input` event the design asks for (a controlled `value` with only
   `onInput` warns). `isComposing` / `compositionend` guard IME text, and `onBlur` flushes a pending
   value. During composition nothing is written, so a composing string is committed as one diff.
7. **An open editor also adopts remote text (`ytext.observe` with a `LOCAL_ORIGIN` guard).**
   Not in story 2's spec (there is a single writer), but without it the editor would overwrite any
   incoming change to the note it is editing. Harmless now, needed unchanged in story 3.
8. **e2e reaches 50% and 200% zoom through the story 1 test hook.**
   UI zoom steps are ×1.25, so 0.5× and 2.0× (the design's drag geometry values, TC-31/TC-32) are
   unreachable by clicking. `window.__vidi6.setCamera` only sets up the zoom; the drags,
   double-clicks, typing, clicks and keyboard shortcuts under test are all real user input.
9. **Component harness wraps every interaction in `await act(async …)` and drains rAF.**
   Drags coalesce into `requestAnimationFrame`, and raw `fireEvent.pointer` dispatch is not
   React-wrapped, so without a wrapper React commits land after the assertions. `flushFrames()` drains
   three animation frames plus the scheduler queue. `@testing-library/user-event` is not used for
   drags because jsdom implements neither pointer capture nor layout, so `getBoundingClientRect`
   returns zeros — component tests assert model writes, attributes and rendered structure, and
   geometry is asserted in e2e instead.
10. **Extra `data-*` attributes for tests:** `data-note-id`, `data-selected`, `data-editing`,
    `data-dragging`, `data-color`, `data-z`, `data-overflow` on the note, `data-testid` on the
    toolbar buttons (`swatch-<name>`, `delete-note`, `create-sticky`) and on the text/counter/editor
    nodes. e2e identifies notes by `data-note-id`, never by index, because stacking changes during a
    drag.

## Not covered (by design or by environment)

- **TC-10 (`bringToFront` on the topmost note emits no update)** is covered as a unit test only, as
  the design's negative-scenario table specifies.
- **Real IME composition** cannot be synthesised in jsdom or Playwright; the composition guard is
  covered by unit tests over `applyTextDiff`/`clampToLimit` and by the fact that plain typing works
  in e2e.
- **Touch and stylus input** — the PRD's pointer handling is exercised with mouse-driven pointer
  events only.
- **Note rotation, resizing, shapes, connectors and multi-user presence** belong to later stories.

## Useful facts for the next story

- `src/shared/board-model.ts` is the only place that touches the Yjs schema: `objects` (a `Y.Map` of
  `Y.Map`s), text in a per-note `Y.Text`, `LOCAL_ORIGIN` as the transaction origin. Story 3 can pass
  a doc with a provider attached to `App` (`AppProps.doc`) and needs no model changes.
- `useBoardDoc(providedDoc?)` already accepts an external `Y.Doc`; `App` uses it for both local and
  injected docs.
- `useSelection` is deliberately local-only state; awareness/presence (story 5) is a separate hook.
- The `Y.Doc` a component test creates is also what a story 3 test can pair with a second doc through
  `Y.applyUpdate`, which is how "remote" edits are already simulated (`mutate` in
  `tests/component/appHarness.tsx`).
- Note drag geometry divides the screen delta by `camera.zoom` and positions absolutely, so a camera
  change mid-drag (story 3 remote camera, story 6 shared view) is the place to re-check.

## Story 3 notes

### `@cloudflare/vitest-plugin` instead of `@cloudflare/vitest-pool-workers`

The design names `@cloudflare/vitest-pool-workers`, which is deprecated and peer-pinned to
vitest 4; this repo pins vitest 5.0.3. `@cloudflare/vitest-plugin@1.4.0` is its successor,
runs integration tests in workerd against `wrangler.jsonc`, and works with vitest 5. The
integration project is separate (`vitest.integration.config.ts`, `npm run test:integration`)
because it needs the Workers runtime while unit/component tests stay in jsdom.

### Capacity is soft, and stays unimplemented as a rule

`MAX_CONCURRENT_EDITORS = 5` is a test participant count. Nothing in the room or the client
turns a sixth joiner away — TC-13 asserts the opposite, and the spec repeats it ("no
participant counting", "over-capacity joiners are never refused"). An earlier draft of the
room closed the sixth socket; that was wrong and was removed.

### Text editor anchoring (why `StickyTextEditor` looks the way it does)

Insertions are anchored with `assoc: 1` at the DOM caret index: `caretIndex` then reads back as
that exact index, so typing "red", " green", " blue" from one caret lands as typed instead of
interleaved ("r ge cbluedeen"). The anchored path is only taken for a keystroke that changed the
value the component itself last rendered and did it at the caret (`Math.abs(delta.prefix -
before.caret) <= 1`); paste, cut and select-all replace come out of `applyTextDiff` as a block.
The caret anchor is re-created on keyup/click/select whenever the DOM value is in sync with the
shared text, which is what lets remote edits shift the anchor under the caret. `applyChange`
bails out when the value it is given is already the value it wrote or the value the shared text
already holds, which is what stops a blur after an interrupted keystroke writing the text twice
(that duplication was a firefox-only regression before the guard).

### Firefox facts measured on this machine

- `context.setOffline(true)` does not disturb an established websocket in firefox: a probe
  measured the board's connection still 'connected' 90 seconds into an outage. Chromium drops
  it, so TC-27 runs in chromium only, and the spec says so in a `test.skip` message.
- Firefox fires the blur-triggered change handler with a value the component had not yet
  rendered, which is the case the idempotency guard above handles.
- WebKit is not installed on this machine, so the third Playwright project never runs.

### E2E helper geometry that the soak needed

- `moveNoteBy` drags the note's *centre* by (dx, dy): the note ends up exactly that far away.
  Dragging to "box corner + delta" moved the note half a note size off, which only became
  visible when drags accumulated.
- `createNote` identifies the new note by which `data-note-id` appeared, not by DOM order: the
  board paints in z order and drags and selections rearrange it.
- The soak keeps its notes in a slot grid whose rows are 160px apart at 50% zoom, because a
  note's colour toolbar lives in the gap above it and the note in the next row used to cover it
  (Playwright then reports "intercepts pointer events").
