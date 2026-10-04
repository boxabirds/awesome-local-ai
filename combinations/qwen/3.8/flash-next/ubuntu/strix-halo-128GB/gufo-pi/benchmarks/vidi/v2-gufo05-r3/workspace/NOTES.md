# NOTES

Decisions and deviations for **Story 1 — Pan and zoom around an infinite board**.

## Stack / versions
- Vite 6 + React 19 + TypeScript. Vitest 2.1.9 (unit + component), Playwright 1.63.0 (e2e), Wrangler 3.114.17 (static asset server).
- Playwright 1.63.0 was chosen because the locally cached browsers (chromium-1243, firefox-1543, webkit-2359) match it exactly, so no browser download is needed.

## Vitest projects
- The design says `vitest.config.ts projects: unit|component`. Vitest 2.x expresses projects through a **workspace file**, so they live in `vitest.workspace.ts` (projects named `unit` and `component`). `npm run test:unit` / `test:component` still select them via `--project`. Functionally identical to the design's intent.

## wrangler assets-only
- The design's `wrangler.jsonc` had an assets binding. Wrangler 3 rejects an assets binding in an **assets-only** project ("Cannot use assets with a binding in an assets-only Worker"), so `assets.directory` is configured with **no binding**. `wrangler dev` then serves `dist/client` at `/`, which is what e2e needs. A Worker `main` arrives in story 3.
- `compatibility_date` is set to `2025-06-01` (the date supported by the bundled Workers runtime) to avoid a runtime-fallback warning.

## Camera update batching (rAF)
- The design mentions coalescing camera updates with `requestAnimationFrame`. Updates are instead applied synchronously to an internal ref + `setState`. React 18/19 automatic batching already limits this to at most one render per event, and the browser fires at most ~one `pointermove` per frame, so the "one render per frame" intent holds while component tests stay deterministic (no fake-timer coupling). Documented here as the deliberate trade-off.

## Component layout (who owns `useCamera`)
- The design contracts: `BoardViewport({ children })` is the input surface; `ZoomControls`/`NavigationHint` are presentational; all three connect to the one `useCamera` instance. To honour these exact signatures while sharing a single camera, `BoardViewport` owns `useCamera` (and the `ResizeObserver` viewport size) and lays out the fixed-position `ZoomControls` and `NavigationHint` overlays, wiring them to the hook. `App` simply mounts `BoardViewport` full-window. The overlays use `position: fixed`, so the visual structure (bottom-right controls, bottom-centre hint) matches the PRD.
- `useCamera` gained two extra methods beyond the listed contract: `zoomAtPoint(point, factor)` (needed to drive Safari `gesturechange` zoom, which is not expressible through the `wheel` signature) and `setCamera(next)` (needed by the test hook `window.__vidi6`). Both reuse the same commit path (same-object check, `hasNavigated` latch).

## Test hook
- `window.__vidi6.setCamera` is installed only when `import.meta.env.MODE === 'test'`. Verified: the production build does **not** contain `__vidi6`; `vite build --mode test` (script `build:test`) does. e2e runs against the test build served by `wrangler dev`.

## Ports
- All servers listen inside the allowed range 23616–23631: Vite dev `23616`; Playwright `webServer` runs `wrangler dev` on `23620` with inspector port `23621`.

## Origin marker
- An always-rendered, `aria-hidden` crosshair positioned in screen coordinates at `worldToScreen(camera, {0,0})`. It gives e2e a stable, constant-size pixel target for "the board's starting point".

## e2e browsers (Firefox / WebKit)
- Firefox and WebKit browsers are installed and configured, but this host is missing their OS runtime libraries (`libgtk-3-0t64`, `libflite*`, etc.), so `browserType.launch` fails with "Host system is missing dependencies to run browsers". Installing them requires `sudo apt-get install` and root is unavailable (`no new privileges`).
- Per the task rules ("Chromium is sufficient if other browsers are not installed"), `npm run test:e2e` runs the Chromium project by default and all 5 e2e cases (TC-23..TC-27, TC-31) pass there. Firefox/WebKit projects are gated behind `E2E_ALL_BROWSERS=1` and run unchanged on a host that has the browser OS dependencies. The three e2e workflows are identical across engines; only the launch environment differs.

## Not covered (per design "Not covered")
- Trackpad hardware inertia/delta scaling; Safari native pinch in e2e (Playwright WebKit cannot synthesise `GestureEvent` — the component test TC-17 covers the handler).
