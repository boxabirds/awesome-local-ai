# Story 1 implementation notes

Decisions, deviations and things worth knowing before story 2 builds on this.
Nothing here changes the behaviour the story asks for; where the implementation
differs from `design.md`, the reason is given.

## Structure

- **`App` owns `useCamera`, not `BoardViewport`.** The design's contract for
  `BoardViewport` lists only `children`, but the same camera has to reach
  `ZoomControls` (`zoomPercent`, `canZoomIn/Out`) and `NavigationHint`
  (`!hasNavigated`). Lifting the hook into `App` is the only way to keep one
  camera, and it still matches the design's structure diagram (hook in the
  middle, viewport/controls/hint around it). `BoardViewport` therefore takes a
  `camera: CameraApi` prop. Everything else about the component matches the
  contract.
- **`useViewportSize` lives in `useCamera.ts`** rather than a new file; the
  design's layout table does not list a file for it.
- **`src/client/canvas/testHooks.ts` is a separate module** (the design names
  `testHooks.ts` in task 1.3) and only installs `window.__vidi6` when
  `import.meta.env.MODE === 'test'`. Verified: `npm run build` output contains no
  `__vidi6`, `npm run build:test` does.
- `data-camera-x`, `data-camera-y` and `data-camera-zoom` are rendered on the
  viewport. They make the rendered camera observable from a test or DevTools
  without reaching into React, and cost nothing.

## Input handling

- **The wheel listener is attached natively with `{ passive: false }`**, not as a
  React `onWheel`. React registers wheel listeners as passive at the root, so
  `preventDefault()` inside a React wheel handler does nothing and the browser
  would zoom the page (`zoom.no_page_zoom`). Same reason the Safari
  `gesturestart/change/end` listeners are native.
- The wheel handler is on the board surface element only, and the controls
  container additionally `stopPropagation`s its React `onWheel`, so `Ctrl` +
  wheel over the zoom control neither zooms the board nor is swallowed
  (TC-30).
- A drag only starts when `event.target` carries `data-board-surface="true"`.
  Note this is deliberately *not* `event.target === viewport`: the world layer
  and the origin marker are marked as surface too, because they are the visible
  board. Objects added in later stories must not set that attribute and then
  they keep their own drags.
- `pointercancel` and `lostpointercapture` end the drag exactly like
  `pointerup`, leaving the camera where it was when the drag was interrupted.
- Safari pinch is translated into the hook's wheel-shaped input by inverting
  `factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`, so there is one zoom path.
- **`hasNavigated` latches one way** (a ref, never reset), and only when
  `camera.ts` returns a *new* object. A click without movement, and a zoom at a
  limit, return the same object, so they do not dismiss the hint (TC-29).
- **Camera updates are coalesced per animation frame.** `apply()` updates
  `cameraRef.current` synchronously (so the next event computes from the latest
  camera) and defers the React state update to the next `requestAnimationFrame`.
  A bare jsdom has no `requestAnimationFrame`, so there is a `setTimeout`
  fallback.

## Camera maths

- `zoomStep` snaps the result to the nearest `ZOOM_STEP_FACTOR^n` when it is
  within `ZOOM_STEP_SNAP_EPSILON`, which is what makes "step in then step out" return
  *exactly* `1` instead of `0.9999999999999999` (TC-09), while a pinch or wheel
  zoom can still land anywhere in range.
- `clamp` keeps non-finite zoom out of the camera: a non-finite factor or a
  non-finite zoom returns the input camera untouched (TC-12), so `NaN` can never
  enter the transform.
- Panning at 1,000,000 world units is exact in doubles; no re-basing is needed
  (TC-02, TC-27).

## Tests

- **Component tests wait for real frames instead of fake timers.** Task 1.6
  suggested fake timers for rAF; with a `setTimeout` fallback and React's own
  scheduling, fake timers made the tests depend on the ordering of internal
  queues. `settle()` awaits three frames, which is enough for an update to be
  scheduled and committed, and keeps the tests honest about the coalescing.
- **`preventDefault` is asserted through `fireEvent`'s return value.**
  Testing Library's `fireEvent.*` returns `!event.defaultPrevented`, and returns
  a boolean rather than the event, so "the board consumed it" is
  `expect(fireEvent.wheel(...)).toBe(false)`. The gesture test constructs a real
  `Event` and reads `defaultPrevented` off it.
- `tests/component/setup.ts` stubs `ResizeObserver` (absent in jsdom) and pins
  `window.innerWidth/innerHeight` to 1280x800 so the initial camera — and
  therefore every expected transform — is deterministic and matches the e2e
  viewport.
- `tests/component/fixture.ts` reads the camera back from the viewport's data
  attributes at full double precision, so component assertions compare against
  `camera.ts` output to the bit rather than to rounded literals.
- **e2e browsers are auto-detected.** `playwright.config.ts` declares
  chromium/firefox/webkit projects and keeps the ones whose browsers are
  installed (`E2E_BROWSERS=chromium,...` overrides). This machine only has
  Chromium, so the suite was run with `E2E_BROWSERS=chromium`; the other two
  projects will run wherever they are installed. Playwright cannot synthesise
  Safari `gesture*` events — as the story's test strategy already says, those
  are covered by the component test TC-17 instead.
- The e2e suite waits on rendered state (`expect.poll`, `toHaveText`,
  `expectMarkerAt`) rather than reading once, because camera updates land on the
  next frame; reading immediately after an action was enough to make a
  `Ctrl+0` reset flaky during development.
- Beyond the listed test cases, the e2e suite also covers `pan.scroll` in both
  axes, the `10%` zoom-out limit, and the keyboard shortcuts, because those
  requirements had no e2e case of their own.

## wrangler.jsonc

`wrangler` 4 rejects an `assets.binding` in a Worker that has no `main` script,
so this story's config is assets-only (`assets.directory = dist/client`,
`not_found_handling = "single-page-application"`). Story 3 adds `main`, the
`ASSETS` binding and the Durable Object binding when the Worker appears.

## Not done here

- **Task 1.3's "Done when" includes a manual check in Chrome and Safari.**
  Safari/macOS is not available in this environment. Chromium is verified by the
  e2e suite; the Safari-only `gesture*` handlers are verified by TC-17 at the
  component level. Worth a real-device pass before release.
- `@testing-library/user-event` is installed because the scaffold asks for it,
  but the viewport tests use `fireEvent`/direct `dispatchEvent`: user-event
  cannot synthesise `wheel` with `deltaMode`, `pointercancel`, or `gesturechange`.
  Story 2's note-editing tests are a better fit for it.

---

# Story 2 implementation notes

Sticky notes: model, text, interaction and toolbars. As above, where the
implementation differs from `design.md`, the reason is given.

## Structure

- **`src/shared/board-model.ts` is framework-free** as the design asks, so story
  4 can import it for validation and migration. It owns the Yjs schema
  (`meta.schemaVersion`, `objects`), `LOCAL_ORIGIN` and every mutation. One
  `doc.transact(fn, LOCAL_ORIGIN)` per successful call; every rejected call
  (stale id, unknown colour, non-finite coordinate, no-op) returns `false` and
  emits no update — the unit tests count `update` events to prove it.
- **`snapshot()` returns frozen values** (and a frozen array, sorted by `(z, id)`)
  so a component cannot mutate board state by accident, and so `useSyncExternalStore`
  can compare snapshots by identity.
- **`useBoardDoc` uses `useSyncExternalStore`** with a cached snapshot that
  `observeDeep` invalidates. `doc.getArray`/`getMap` calls are stable, so the
  store subscribes once per doc.
- **`useSelection` is one state object** `{selectedId, editingId}`, not two. Two
  `useState` cells made `endEdit('selected')` read a stale selection during the
  outside-pointerdown → press-a-new-note sequence; one object cannot.
- The `window.__vidi6` hook gained `getDoc()` (story 2's addition to story 1's
  hook object). `useCamera` still installs the hook; `App` patches `getDoc` onto
  it, so the hook stays one object and stays test-mode-only.

## Text

- **Every `input` event is written immediately** (`applyTextDiff` with common
  prefix/suffix, clamped by `clampToLimit`), so ending editing — by Escape, by a
  click outside, by blur, or by unmount — has nothing left to commit and cannot
  lose characters. `onBlur` re-flushes defensively.
- **There is no separate `onPaste` handler.** A paste arrives as an `input` event
  like any other, and the same clamp applies: a 1,200-character paste keeps
  exactly the first 1,000 and the caret is moved back to the end of what was kept.
- IME composition is skipped between `compositionstart` and `compositionend`; the
  final value is flushed once at `compositionend`.
- `fitFontSize` measures `scrollHeight` against the text box in world units
  (`STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD`) and binary-searches integers
  from `STICKY_FONT_MAX_PX` (24) down to `STICKY_FONT_MIN_PX` (10). CSS mirrors
  `STICKY_PADDING_WORLD` and `STICKY_LINE_HEIGHT` as `--sticky-padding` and
  `--sticky-line-height` in `:root`; those two values must be kept in step with
  `src/shared/config.ts` by hand, which is the one place where a config change
  needs a second edit.

## Interaction

- **Notes are rendered in a stable order (by id) and painted with CSS
  `z-index`.** The design's "sorted by `(z, id)`" is the *snapshot* order; using
  it as the DOM order broke dragging. Raising a note re-sorts the list, React
  re-inserts the element under the pointer, and the browser releases pointer
  capture (`lostpointercapture`), which ended the drag after its first move.
  `z-index` paints identically and never moves a node; TC-32 is the regression
  test. Test helpers therefore sort by `z-index` when they want paint order.
- **Drag deltas are divided by the camera zoom** and coalesced into one
  `moveObject` per animation frame; the last pointer position before release is
  applied on release, so the committed position is exactly where the pointer was.
- `bringToFront` runs once, when the drag crosses `DRAG_THRESHOLD_PX`. A press
  that never crosses it is a click: no write, no raise.
- Editing ends in three distinct ways, on purpose: Escape keeps the note selected
  (`onEnd('selected')`), a pointerdown outside deselects (`onEnd('unselected')`),
  and pressing a different note ends editing and selects that one.
- `setPointerCapture` is wrapped in `try/catch`: jsdom does not implement it, and
  a pointer that is already gone throws in a browser. Neither should break a drag.
- The window keyboard handler bails out on `isTextEntryTarget(event.target)` and
  whenever a note is being edited, which is what keeps Backspace from deleting a
  note while its text is being typed (TC-26).

## Deviations from the design

- **`NoteToolbar` is rendered inside the note, counter-scaled with
  `transform: scale(1 / zoom)`**, instead of in a separate screen-space layer.
  The visible result is what the design asks for — a fixed on-screen size above
  the note — with one element less to keep in sync with the camera; the e2e test
  "the note toolbar … keeps its screen size" checks it at 100% and 200%.
- **`StickyNote` carries extra `data-note-*` attributes** (`id`, `color`, `x`,
  `y`), which the design does not list. jsdom has no layout, so component tests
  assert positions from world coordinates plus camera maths, and the browser tests
  read the same attributes. They cost nothing and make the board debuggable.
- **`STICKY_COLOR_ORDER` and `stickyColorLabel()` are exported from
  `NoteToolbar.tsx`/`config.ts`** so tests and the toolbar read the colour names
  from one place. The palette key is `violet`, not `purple`.

## Tests

- Component tests are split as the design names them: `StickyNote.test.tsx`,
  `StickyTextEditor.test.tsx`, `Toolbars.test.tsx`, with the shared plumbing in
  `sticky-helpers.ts` (camera maths, note lookup in paint order, drags, typing).
  They render `<App />` and read the document through `window.__vidi6.getDoc()`.
- `@testing-library/user-event` is used where story 1's notes predicted it would
  fit — `{backspace}` inside a textarea (TC-26) — and `fireEvent` everywhere a
  real event shape matters.
- jsdom has no layout, so `fitFontSize` cannot be tested there beyond "it does not
  throw and picks the largest size": overflow, the fade and the real font size are
  e2e (TC-33).
- **The e2e `beforeEach` only pushes a camera when it differs from the start.**
  `setCamera` through the test hook goes through the same `apply()` as a real pan,
  which latches story 1's `hasNavigated` forever; pushing it unconditionally made
  the first-use hint untestable in every e2e test.
- A full note of prose is inserted in e2e with the native value setter plus an
  `input` event — the standard way to drive a React-controlled textarea — because
  typing 1,000 characters keystroke by keystroke is slow, and a paste is a single
  change.
- Only Chromium is installed here, so the suite ran with the chromium project;
  `playwright.config.ts` picks up firefox and webkit wherever they are installed.

## Not done here

- The "Done when" manual passes at 50/100/200% zoom are covered by TC-31 and
  TC-32 in Chromium; no Safari or Firefox run in this environment.
- Stories 6 and 13–17 are excluded, so there is no persistence, no
  collaboration, no undo and no shapes/frames/arrows yet — the board is empty on
  every reload.
