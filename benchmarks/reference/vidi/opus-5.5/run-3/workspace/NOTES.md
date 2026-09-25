# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec left room:

- **Where `useCamera` lives.** The design gives `BoardViewport` only a `children` prop but also wants the
  viewport to measure its own size (ResizeObserver) and the zoom controls to stop wheel propagation into the
  board (TC-30). So `BoardViewport` calls `useCamera` itself and renders `ZoomControls` and `NavigationHint`
  as fixed overlays inside it. `App.tsx` just mounts `<BoardViewport />`. The controls and hint still take
  exactly the props in the design.
- **Stopping wheel propagation over the controls.** React's synthetic `onWheel` runs after the board's native
  listener, so `ZoomControls` adds its own native `wheel` listener that calls `stopPropagation` (and does not
  call `preventDefault`, so the browser default is kept there, per TC-30).
- **Initial view.** The board opens in the same view as Reset view: 100% with the origin centred.
- **Batching.** Continuous input (drag, wheel, Safari gesture) is rendered at most once per animation frame.
  Discrete actions (buttons, shortcuts, reset) render right away so the label updates as soon as the click
  happens.
- **Extra `useCamera` members.** Besides the contract, `useCamera` returns `zoomBy(point, factor)` (Safari
  gestures) and `setCamera(cam)` (only used by the test hook; it does not dismiss the hint).
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` exists only when `import.meta.env.MODE === 'test'`
  (Vitest, and `vite build --mode test`, which `npm run test:e2e` runs before Playwright). `npm run build`
  (production) does not include it — checked by grepping the bundle.
- **Grid dots** sit on world multiples of `GRID_SPACING_WORLD`, so the origin marker is on a dot. Dots fade
  once their on-screen spacing drops below `GRID_FADE_BELOW_SPACING_PX`, so a zoomed-out grid does not turn
  into a grey wash. Wheel line-mode deltas use `WHEEL_LINE_HEIGHT_PX`. Both are new settings in
  `src/shared/config.ts`.
- **Shortcuts.** Ctrl/Cmd with `=`/`+`/NumpadAdd zooms in, `-`/`_`/NumpadSubtract zooms out, `0`/Numpad0
  resets. They are handled on `window` (as the design says), but ignored when focus is in a text field, so
  later stories that add text inputs aren't affected.
- **Pan buttons.** Primary- and middle-button drags on empty board space pan.
- **Firefox in Playwright.** Firefox's own macOS sandbox can't start when the test runner is itself sandboxed,
  so the Playwright Firefox project turns it off with the `MOZ_DISABLE_*_SANDBOX` env vars and
  `security.sandbox.content.level = 0`. This only affects the test browser.
- **Red phase.** Task 1 asks for a separate commit of the failing unit tests. The instructions for this build
  ask for one commit per story, so the red phase (every test failing with "not implemented") was run but not
  committed on its own.
- **Manual checks not done here.** Real trackpad pinch in Safari, and smoothness / frame rate, are manual
  checks (design "Not covered"). The Safari gesture handler is covered by component test TC-17.
