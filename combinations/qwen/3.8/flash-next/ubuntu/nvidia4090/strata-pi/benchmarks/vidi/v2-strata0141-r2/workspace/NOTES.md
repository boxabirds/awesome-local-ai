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

- **WebKit e2e project.** The WebKit binary installs, but it cannot launch on this machine:
  `libavif.so.13`, `libsoup-3.0.so.0`, `libjxl.so.0.8` and `libbacktrace.so.0` are missing
  (`ldd` reports "not found"). Installing them needs `sudo npx playwright install-deps` /
  `apt-get install libavif13`, and this machine has neither sudo nor apt access (package mirrors are
  blocked by the proxy, HTTP 403). `playwright.config.ts` detects missing host libraries and drops the
  WebKit project instead of failing the suite, so `npm run test:e2e` stays green.
- **Chromium had to be located, not installed.** `npx playwright install chromium` fails here: the
  Chrome for Testing download returns HTTP 403 from `cdn.playwright.dev` through the proxy. A Chrome
  for Testing build already on the machine is used instead
  (`~/.cache/vidi-agent-ms-playwright/chromium-1243/chrome-linux64/chrome`), selected by
  `chromiumExecutable()` in `playwright.config.ts` (override with `VIDI6_CHROMIUM_PATH`).
- **Result:** e2e runs in Chromium and Firefox (18 tests, all passing). Design asked for Chromium,
  Firefox and WebKit.

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
