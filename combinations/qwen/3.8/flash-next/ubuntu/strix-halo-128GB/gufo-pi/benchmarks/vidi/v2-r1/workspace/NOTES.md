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
