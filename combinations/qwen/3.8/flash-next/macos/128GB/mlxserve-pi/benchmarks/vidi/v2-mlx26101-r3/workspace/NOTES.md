# vidi6 — working notes

Kept current by whoever works on the repo. Records verified commands, deviations from the
story design, and gotchas for the next story.

## Commands (all verified in this environment)

| Command | What it does |
| --- | --- |
| `npm install` | Install deps (Node 24, npm 11). |
| `npm run dev` | Vite dev server on `http://127.0.0.1:23600`. Story 1 has no server code, so no Worker is needed in dev. |
| `npm run build` | Production client build → `dist/client` with **stable** asset names (`assets/app.js`, `assets/index.css`). |
| `npm run build:test` | Same build with `MODE=test`, which compiles in the `window.__vidi6` e2e hook. Must run before `test:e2e` (the Playwright `webServer` command does it). |
| `npm run preview` | `wrangler dev` serving `dist/client` at `http://127.0.0.1:23612` (inspector port 23613) — the same serving path later stories use. |
| `npm run typecheck` | `tsc --noEmit` over `tsconfig.json` (src) **and** `tsconfig.test.json` (tests + Playwright config). |
| `npm run test:unit` | 67 tests, node environment (camera 23, board model 25, sticky text 19). |
| `npm run test:component` | 82 jsdom tests (viewport input, zoom controls, hint, sticky note, sticky text editor, toolbars). |
| `npm run test:e2e` | Playwright. Starts `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 23614 --inspector-port 23615`, viewport 1280×800, **Chromium only by default** (see deviation 1). 43 tests (story 1 23, story 2 20). |
| `BROWSERS=all npm run test:e2e` (or `npm run test:e2e:all-browsers`) | Chromium + Firefox + WebKit. |
| `npm run check:no-test-hook` | Fails if a built asset contains `__vidi6` (run after `npm run build`). |
| `npm run verify` | typecheck → build → no-test-hook → unit → component → e2e(Chromium). One command for the whole gate. |

Ports in use: dev `23600`, preview `23612/23613`, e2e `23614/23615` (override with
`DEV_PORT`, `E2E_PORT`, `E2E_INSPECTOR_PORT`).

## Deviations from `spec/stories/.../design.md`

1. **Non-Chromium Playwright projects are opt-in.** The design wants Chromium, Firefox and
   WebKit projects. All three are configured, but in this sandbox the bundled Firefox and
   WebKit binaries abort on launch (`SIGABRT` / `Abort trap: 6`; `BROWSERS=all` reproduces
   it) — an environment limit, not a product problem, so the default project list is
   Chromium only and the full matrix is one env var away. Everything the Safari/WebKit
   pinch path does is covered in jsdom with synthetic `gesturestart/gesturechange` events
   (`tests/component/BoardViewport.test.tsx`, TC-17/TC-17b).
2. **e2e runs on port 23614 (+ inspector 23615)** instead of a 3000-class port, because this
   agent may only bind 23600–23615.
3. **`wrangler.jsonc` has no Worker `main` and no `ASSETS` binding.** wrangler 4 rejects
   `Cannot use assets with a binding in an assets-only Worker`. Story 3 adds `main`; that is
   when `"binding": "ASSETS"` goes back in. `dev.port` / `dev.inspector_port` are set so
   `npm run preview` also stays inside the allowed port range.
4. **Stable built asset names** (`build.rollupOptions.output.*FileNames`). With content
   hashes, a `wrangler dev` that is already running 404s on the new hashed file (it builds
   its asset list at startup). Wrangler hashes assets itself on deploy.
5. **Extra e2e files** next to the designed `tests/e2e/navigation.spec.ts`:
   `layout.spec.ts` (board fills the window, `touch-action`/`overscroll-behavior`, `grab` and
   `grabbing` cursors, wheel over the controls does nothing, drags starting on the overlay do
   nothing, controls do not scale with zoom, dot-grid alignment to world grid lines, resize
   leaves content where it is, zoom keeps the viewport centre) and `touch.spec.ts` (touch drag pans via CDP
   `Input.dispatchTouchEvent`; skipped for non-Chromium projects).
6. **Interaction tests use `fireEvent` + real DOM events; only the zoom-control clicks use
   `user-event`.** Pointer/wheel/gesture sequences need exact event objects and
   `defaultPrevented` assertions. Fake timers are limited to
   `{ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] }`: faking every timer makes
   React's scheduler spin inside `advanceTimersByTimeAsync` and the test hangs.
7. **The world layer carries a `data-camera="x,y,zoom"` attribute.** It is the readout that
   pixel-free assertions (far-travel exactness) and debugging use.
8. **The e2e test hook is `window.__vidi6.setCamera({ x?, y?, zoom? })`**, applied without
   clamping x/y (jumping 1,000,000 units away is the whole point of the fixture).
9. **`src/server/` was not created** — nothing in story 1 needs server logic.
10. **One extra named setting:** `STICKY_PADDING_WORLD` (12) sits with the other sticky
    settings in `src/shared/config.ts`. The design lists note size, colours, text limit and
    font range as product settings; the text inset is the same kind of number and the auto-fit
    needs it, so it lives in the same place instead of being hardcoded twice.
11. **`StickyNoteProps` takes `zoom`, not the whole `camera`,** and its callbacks are
    `onStartEdit(id)` / `onEndEdit(next)` (`EditEnd = 'selected' | 'unselected'`) rather
    than the design's no-arg `onStartEdit()` / `onEndEdit()`: `BoardViewport` renders the notes,
    so it needs the id back, and `App` has to know *why* editing ended to keep the selection
    rule (Escape keeps it, a click outside drops it). `zoom` is all the drag maths needs — the
    translation cancels out of a delta.
12. **The note element is not the clipping box.** `.sticky-note` has no `overflow: hidden`,
    because the colour/delete toolbar hangs above the note's top edge and would be cut away;
    the inner `.sticky-note__clip` is the box that clips text (176×176 world units, i.e.
    `STICKY_SIZE_WORLD - 2 * STICKY_PADDING_WORLD`). e2e assertions about clipping therefore
    look at `.sticky-note__clip`, and `noteFontSize`/`textOverflow` read the textarea while
    editing and the clip after it (a `overflow: hidden` textarea is its own scroll container,
    so the overflow never reaches the clip while typing).
13. **The note toolbar counter-scales.** It is rendered in world coordinates inside the note
    (so it moves with the note for free) from a zero-size anchor at `left: 50%; bottom: 100%`
    with `transform: translateX(-50%) scale(var(--inv-zoom))`, `--inv-zoom` being `1 / zoom`
    from React. That is what "drawn in screen space, a usable size at any zoom" means here
    (e2e TC-34c asserts the toolbar is between 10 and 60 px tall at 50%).
14. **Escape is the editor's key, Enter/Delete/Backspace are the board's.** The textarea owns
    Escape in its own `onKeyDown`; `App` listens on `window` for Enter/F2 (edit the selected
    note) and Delete/Backspace (delete it), skipping anything whose target is an editable
    element. Component tests therefore press Escape with `pressKeyIn(editor, 'Escape')` and the
    rest with `pressKey(key)` (which fires on `window`).
15. **`bringToFront` happens on `pointerdown`, not when the drag threshold is crossed**, as the
    design's Step 4.2 says. A press that only selects still raises the note; the position is
    untouched until the threshold is crossed, which is what TC-19 ("2 px is a click") is about.
16. **Extra test files** beside the designed ones: `tests/unit/board-model.test.ts`,
    `tests/unit/sticky-text.test.ts`, `tests/fixtures/texts.ts`,
    `tests/component/StickyNote.test.tsx`, `tests/component/StickyTextEditor.test.tsx`,
    `tests/component/Toolbars.test.tsx`, `tests/component/helpers/sticky.tsx`,
    `tests/e2e/sticky-notes.spec.ts`, `tests/e2e/helpers/sticky.ts`.

## Gotchas / findings for the next story

- **Coordinate contract** (everywhere): `screen = (world - camera.xy) * zoom`,
  `world = screen / zoom + camera.xy`. The world layer renders it as
  `transform: scale(zoom) translate(-x px, -y px)` with `transform-origin: 0 0`. Swapping
  `scale`/`translate` shifts the world by a factor of zoom — three e2e tests fail if you do.
- **Never round `camera.x` / `camera.y`.** All pan/zoom maths stays in double precision so
  sub-pixel precision survives at 1,000,000 units out (PRD "No edges"). Only the *label*
  rounds (`zoomPercent`).
- **React attaches `wheel` as a passive listener at the root**, so `onWheel` +
  `preventDefault()` throws "Unable to preventDefault inside passive event listener". The
  board's wheel handling is a native `addEventListener('wheel', fn, { passive: false })` in
  `BoardViewport`. Keep it that way.
- **Drag vs. objects:** only elements carrying `data-board-surface` start a pan; anything
  inside `[data-board-ui]` (the overlay) is ignored by both the pan and wheel handlers.
  Story 2's sticky notes should call `stopPropagation()` on `pointerdown` to own their drag.
  `touch-action: none` (in CSS, not inline) is what stops the browser panning/zooming.
- **Pointer capture:** `setPointerCapture` on the viewport retargets later pointer events, so
  dragging continues even when the pointer is over the overlay. `onLostPointerCapture` ends
  the pan; `panningRef` (a ref, not state) is the synchronous source of truth.
- **`deltaMode` matters:** Firefox reports `DOM_LINE_NUMBER` (1) and some setups report pages
  (2). `wheelPixelScale` converts lines → `WHEEL_LINE_HEIGHT_PX` and pages → viewport height,
  otherwise panning feels 3× slower in Firefox.
- **Safari `gesture*` events** carry `scale` measured *since the gesture started*, so zoom is
  applied incrementally (`scale / lastScale`). A test that uses scales 1 → 2 → 4 cannot catch
  the difference because the clamp at 4 hides it — the component test uses 1.2 → 1.5 for that
  reason.
- **Camera updates are coalesced with rAF** (at most one render per frame), so any assertion
  on the DOM must wait a frame: `settle()` (e2e, two `requestAnimationFrame`s) or
  `flushFrames()` (component). `useCamera` also keeps `cameraRef` synchronously up to date,
  which is what makes rapid-fire events exact.
- **A window resize never moves the camera.** `useCamera` seeds the standard view from
  `resetCamera({ width: window.innerWidth, height: window.innerHeight })` at first render and
  the `ResizeObserver` size is only used for page-mode wheel deltas and the zoom-step centre.
  (PRD "Resizing the browser window does not move content relative to the top-left corner" +
  design "camera x, y is unchanged by design"; asserted by TC-07 component and the e2e resize
  test.) Because of that, jsdom component tests must emulate the window size —
  `tests/component/setup.ts` redefines `window.innerWidth/innerHeight` to 1280×800 to match the
  e2e viewport; jsdom's own 1024×768 would give a different standard view.
- **jsdom gaps:** no `ResizeObserver` (stub in `tests/component/resizeObserver.ts`, drive it
  with `setObservedSize()`), and essentially no CSS cascade/layout — element rects are 0×0,
  so pixel assertions there are impossible (the origin marker still gives a usable centre
  because it has a fixed CSS size and is centred by a counter-scale). CSS-level regressions
  belong in e2e: the e2e run caught a real one (`overscroll-behavior` was only on
  `html, body`, not `.board-viewport`) that jsdom happily reported as correct.
- **The dot grid** is a CSS `radial-gradient` background on a full-viewport layer:
  `background-size = GRID_SPACING_WORLD * zoom`, `background-position =
  mod(-camera.xy * zoom, spacing) - spacing/2` (the half-tile correction is what puts a dot
  exactly on a world grid line — `layout.spec.ts` asserts that).
- **Zoom step snapping:** `zoomStep` snaps a target zoom to the nearest `ZOOM_STEP_FACTOR^n`
  within `ZOOM_STEP_SNAP_EPSILON * max(1, snapped)` so step-in → step-out returns to the exact
  zoom it started from; labels then read 100 → 125 → 156 → 195 → 244 → 305 → 381 → 400 (the
  last one is a clamp, not a power of 1.25). The e2e test derives that sequence from the pure
  maths instead of hardcoding it.
- **Sandbox limits worth remembering:** `/tmp` is not writable (scratch files go in `.logs/`,
  which is gitignored), `ps` / `pkill` / `lsof` return nothing, so a manually started
  `wrangler dev` cannot be killed — let Playwright own the e2e port. A stale `wrangler dev`
  on the e2e port is served by `reuseExistingServer: !CI`, so if you ever change asset names,
  change the port too.
- **Story 2 addition, same subject:** `npm run verify`'s last step can therefore be served by a
  `wrangler dev` that is still holding the *production* build `npm run build` just wrote. Run
  `npm run build:test` before `npx playwright test` when a wrangler is already listening on
  23614, or point `E2E_PORT` / `E2E_INSPECTOR_PORT` at free ports inside 23600–23615 and let
  Playwright start its own server.
- **Production must stay hook-free:** `npm run check:no-test-hook` greps the built assets for
  `__vidi6`. It is part of `npm run verify`.
- **Bringing an object to the front takes your pointer capture away.** Notes (and, later,
  every object) are painted in DOM order, so `bringToFront` changes a `z` and React *moves the
  element* — and Chromium answers that with `lostpointercapture` on the first `pointermove`.
  A drag that listens only on its own element therefore ends before it starts, which is
  exactly the bug story 2 had: pressing a note that was not already on top raised its `z` and
  then never moved. jsdom cannot show this (it never fires `lostpointercapture`), so only the
  e2e run caught it. `StickyNote` now tracks `pointermove` / `pointerup` / `pointercancel` on
  `window` for the length of the press, and `lostpointercapture` is ignored while
  `event.buttons !== 0` (the pointer is still down, this is only the reorder); with the button
  released it still ends the drag, as the design's state machine asks. **Story 7 (multi-select
  drag) and story 11 (pen strokes) must do the same** if their gesture changes stacking.
- **`preventDefault` on a keydown that bubbled through a note kills the keystroke.** The note
  cancels Space so the page behind the board does not scroll; doing that unconditionally meant
  a space typed into the note's own textarea never reached the text (`First` + ` idea` came
  out as `Firstidea`). The note's `onKeyDown` returns early when `editing`, and whenever
  `event.target !== event.currentTarget`. `fireEvent.keyDown` gives back `false` when a handler
  cancelled the event, which is how the component test (TC-26b) pins both directions.
- **Notes are drawn in stacking order, so the DOM order is not stable.** Anything that happens
  around a drag looks notes up by id (`noteById`, `stateById`, `centreByIdOnScreen`,
  `toolbarById` in `tests/e2e/helpers/sticky.ts`) instead of by index; `noteIds()` and
  `waitForNote(page, n)` are for the cases where the order *is* the subject. `unchanged(state)`
  compares the fields a drag must not touch — selection is deliberately not one of them,
  because grabbing one note lets go of another.
- **Playwright 1.63 renamed the focus matcher:** it is `await expect(locator).toBeFocused()`;
  `toHaveFocus` no longer exists in the type definitions.
- **jsdom reorders DOM nodes too,** so a component test *can* lock in the stacking part of the
  fix (`TC-20c`: drag the note underneath another one), and `loseCapture(el, at, { buttons })`
  lets a test say which kind of capture loss happened.

## Where story 3 plugs in

- `src/client/board/useBoardDoc.ts` owns the `Y.Doc` (one per mounted board, `initDoc` makes
  sure the `objects` map exists) and `useBoardDoc().notes` gives the render list, sorted by
  `(z, id)`, through `useSyncExternalStore` with a `observeDeep` store. A network provider only
  has to attach to that document — nothing in the rendering path changes.
- Every mutation in `src/shared/board-model.ts` is exactly one `doc.transact(fn,
  LOCAL_ORIGIN)` (a `unique symbol`), so an update can be told apart from an echo: story 3
  filters on origin, story 8 groups undo by it. Rejected operations leave no transaction at all.
- Text lives in a `Y.Text` per note (`getStickyText`), and `applyTextDiff` writes the smallest
  diff, surrogate pairs included, with the origin it is handed. `StickyTextEditor` is the only
  writer while typing.
- The e2e helpers all take a `page`, so a second page on the same URL is a second client; the
  shared-document fixtures story 3 wants are not written yet, but `waitForNote(page, n)` is
  already the "wait for the peer's note to show up" helper. Story 2 only ever used one page.
- `useSelection` is local UI state (which note this browser has picked) — it must not become
  awareness state, and awareness belongs next to `useBoardDoc`.
- `BoardViewport` takes `children` rendered inside the world layer, already in world
  coordinates (world layer scale does the rest). Objects that should not pan the board call
  `stopPropagation()` on `pointerdown` and carry no `data-board-surface`.
