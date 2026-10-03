# NOTES

Decisions and assumptions made while implementing story 1 (Pan and zoom around an
infinite board).

## Decisions

- **`BoardViewport` props**: the design's contract shows `BoardViewport(props: { children? })`,
  but the design also says `App.tsx` owns `useCamera` and wires `ZoomControls` /
  `NavigationHint` to it. Since `ZoomControls` and `NavigationHint` are siblings of the
  viewport (not its children), the viewport needs the camera + actions to render the grid
  and world layer. `BoardViewportProps` therefore extends `CameraApi` (the return type of
  `useCamera`) plus `children`. `App.tsx` calls `useCamera` once and passes the result down.
- **Discrete vs continuous camera updates**: drag and wheel input are coalesced with
  `requestAnimationFrame` (at most one render per frame). Discrete actions (zoom step,
  reset) commit immediately — they already produce at most one render each, and committing
  synchronously keeps the `hasNavigated` latch and the `window.__vidi6` test hook simple.
- **`hasNavigated` latch**: flips only when a *user action* produces a different camera
  object. The initial centre-on-measure (viewport going from 0x0 to a real size) and the
  test hook `setCamera` do **not** count as navigation, so the hint is not dismissed by
  page load or by test setup.
- **Safari pinch**: delivered as `gesturestart`/`gesturechange`. The scale ratio is
  converted to an equivalent Ctrl-wheel `deltaY` (`-ln(ratio) / WHEEL_ZOOM_SENSITIVITY`) so
  it reuses the same pointer-anchored `zoomAt` path.
- **Wheel `deltaMode`**: LINE and PAGE deltas are converted to pixels using named constants
  (16 px/line, 100 px/page) before being handed to the camera.
- **Keyboard**: in addition to `=` and `-`, the shortcuts also accept `+` and `_` (shift
  variants) so Ctrl/Cmd+Shift+= / Ctrl/Cmd+Shift+- behave the same as the plain keys.
- **E2E server ports**: `wrangler dev` runs on port 27240 (inspector 27241), inside the
  allocated `$AGENT_PORT_FIRST`..`$AGENT_PORT_LAST` range. The vite dev server uses
  `$AGENT_PORT_FIRST` (falls back to 5173 if unset).
- **Test mode hook**: `window.__vidi6.setCamera` is registered only when
  `import.meta.env.MODE === 'test'`. The e2e build (`npm run build:e2e`) uses `--mode test`
  so the hook is present; production builds tree-shake it away.
- **`resetCamera` returns a fresh object** even if the camera is already at the standard
  view, so a Reset view press always counts as a navigation (dismisses the hint), matching
  the design ("reset ... produces a new camera object and latches hasNavigated").

## Environment

- Playwright browsers: Chromium and Firefox are installed and both pass the e2e suite.
  WebKit cannot run on this machine: its system dependency `libavif13` is missing and
  cannot be installed (no root; `sudo` is blocked by the no-new-privileges flag; the
  HTTP proxy 403s the Ubuntu archive). Per the task rules ("Chromium is sufficient if
  other browsers are not installed"), this is accepted.
- `npm run test:e2e` runs `scripts/run-e2e.mjs`, which probes each declared browser
  project (chromium, firefox, webkit) and runs the suite for every one that can
  launch. On a machine with all three installed, all three run, as the design
  specifies; here it runs chromium + firefox.
