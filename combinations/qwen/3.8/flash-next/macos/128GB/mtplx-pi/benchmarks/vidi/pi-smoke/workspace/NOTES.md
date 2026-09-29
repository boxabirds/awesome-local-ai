# Story 1 notes

Decisions and deviations made while implementing "Pan and zoom around an infinite board".

## Environment (sandbox) notes — how the toolchain is run
- This working directory sits under an ancestor (`~/.vidi-bench/work`) that Node
  cannot `realpath` (EPERM). Any tool that resolves modules from this path fails. To verify the
  build/tests I ran `tsc`, `vite build`, `vitest` and `playwright` from a mirror of the project
  at a path with readable ancestors, using the same `package.json` scripts and configs. The
  source of truth is still this repo; `package-lock.json` is committed for reproducibility.
- Only Chromium was installed for Playwright; the browser was downloaded on first e2e run.
  Per the task rule ("Chromium is sufficient"), `playwright.config.ts` defines a single
  `chromium` project. Firefox/WebKit are intentionally not configured.

## e2e serving path
- Design suggested serving `dist/client` with `wrangler dev`. `wrangler` writes a cache under
  `$HOME` (which is under the blocked ancestor) and errors, so `playwright.config.ts` serves the
  same `dist/client` with `vite preview` instead. The production build excludes the test hook;
  e2e builds with `--mode test` (`npm run build:test`) so `window.__vidi6` is available to the
  far-jump helper. `wrangler.jsonc` is still provided for the later static-asset/Worker story.

## Camera / UI decisions
- Zoom step snapping (`ZOOM_SNAP_EPSILON` in `src/shared/config.ts`) makes a zoom-in then
  zoom-out pair return to exactly the previous zoom (satisfies the "1.0 -> 1.25 -> 1.0" cases).
  Constants `PERCENT_BASE`, `WHEEL_LINE_HEIGHT`, `WHEEL_PAGE_HEIGHT` are named in the same file
  so no magic numbers appear in the camera code.
- `hasNavigated` is a latch in `useCamera` that only trips when `camera.math` returns a *new*
  camera object, so a zero-length drag and a no-op zoom at a limit never dismiss the hint (TC-29).
- Dot grid is painted with a CSS `radial-gradient`; `background-size = GRID_SPACING_WORLD*zoom`,
  `background-position = -camera.xy*zoom`, so it tracks pan and zoom without per-dot DOM.
- The origin crosshair (`data-testid="origin-marker"`, world 0,0) renders in every build to give
  e2e a stable pixel target.
- Zoom controls + hint are rendered as *siblings* of the wheel surface (not descendants), and the
  control cluster also stops wheel propagation, so Ctrl/Cmd + scroll over the controls never
  reaches the board's zoom handler (TC-30).
- Keyboard shortcuts: Ctrl/Cmd + `=`/`+` zoom in, `-`/`_` zoom out, `0` reset; each `preventDefault`
  so the browser page zoom is not triggered.

## Test-harness adaptations
- Component tests drive the whole `<App/>` (not a hand-wired harness): that keeps them testing the
  real wiring and lets them read the live camera through the test-only `window.__vidi6.getCamera()`.
- jsdom has no `PointerEvent` global and its synthetic mouse events omit `clientX`; the viewport
  tests build a `MouseEvent` with the `pointer*` type name and define `clientX/clientY`, then
  dispatch inside `act()`. The React handlers read the pointer coordinates, so this exercises the
  same code path as a real pointer drag.
- `ResizeObserver`/`getBoundingClientRect` report `0x0` in jsdom; the viewport ignores a `0x0`
  measurement and keeps the configured viewport size (default 1280x800) for step/reset maths.

## Out of scope (left as hooks only, per instructions)
- No presence/offline/sign-in/dashboard/comments/export, no persistence, no touch input. Each
  person's view is their own and is discarded on reload.
