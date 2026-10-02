# Notes

Decisions and judgement calls made while implementing story 1. The spec (`spec/`) is
read-only, so anything that needed interpreting is recorded here.

## Toolchain

- **Vite 8 + React 19 + TypeScript 5.9**, client output to `dist/client`, served by
  `wrangler dev` (`wrangler.jsonc` is assets-only; Worker code arrives in story 3).
- **`.npmrc` sets `legacy-peer-deps=true`.** npm 9.2.0 on this machine aborts on a
  peer-set conflict between `@testing-library/react` 16 and its peers; the flag keeps
  installation working. `@testing-library/dom` therefore has to be a direct dependency
  (it is a peer of `@testing-library/react` v16, not a transitive one).
- **One `vitest.config.ts` with two projects**: `unit` (node environment,
  `tests/unit`) and `component` (jsdom environment, `tests/component`, setup file
  loads `@testing-library/jest-dom`). `test:unit` / `test:component` select them;
  jsdom is deliberately not used for the maths tests.
- **Ports** all sit inside the allowed 20192–20207 range: the e2e `wrangler dev` runs on 20194
  (its inspector on 20195, which is still a localhost listener on 127.0.0.1), and
  `npm run preview` pinned to 20196. Vite's own dev server default (5173) is unused by
  the tests.

## Camera and rendering

- `camera.ts` is **pure maths only** (no DOM, no React), which is what makes TC-01 to
  TC-12 fast unit tests and lets the e2e spec re-use the same functions to predict the
  zoom label sequence.
- Camera updates are **coalesced to one React render per animation frame** in
  `useCamera`: pointer and wheel events update a ref immediately (so a rapid sequence
  of events accumulates exactly) and schedule a `requestAnimationFrame` flush. When
  there is no rAF (jsdom without rAF, hidden tab) it falls back to a 16 ms timer.
  Tests wait for the camera to settle before asserting on pixels.
- **Resize does not move the board**: the camera is the world coordinate at the
  *top-left* of the board area, and the world layer is
  `scale(zoom) translate(-x, -y)` with `transform-origin: 0 0`, so a window resize
  changes only how much board is visible. Covered by an e2e test.
- **Dot grid**: `background-size = GRID_SPACING_WORLD * zoom`, and the position is the
  design's `-x * zoom mod spacing` shifted by half a tile, because a radial gradient
  paints its dot in the *centre* of the tile. Without that half-tile shift every dot
  would sit half a grid cell away from the world coordinates it is supposed to mark.
  The dot radius stays 1 CSS px at all zooms and its alpha fades as the grid gets
  denser, otherwise at 10% the dots (2.4 px apart) merge into a grey wash. Dot alpha
  does not change spacing, so TC-27's spacing assertion is unaffected.
- **Origin marker**: a zero-size element pinned to world (0,0) with a 17 px crosshair
  drawn by a child that is counter-scaled by `1 / zoom`, so the crosshair keeps a
  constant size on screen while its bounding box centre remains exactly the world
  origin — a stable, exact pixel target for the e2e tests (the design asks for a
  marker in all builds).

## Input handling

- **Wheel listener is attached natively with `{ passive: false }`** (React's `onWheel`
  is registered passive, so `preventDefault()` there is ignored and the page would
  scroll or zoom). It converts `deltaMode` lines/pages into CSS pixels with
  `WHEEL_LINE_DELTA_PX` / `WHEEL_PAGE_DELTA_PX`, pans for a plain scroll and zooms at
  the pointer for Ctrl/Cmd + scroll using `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
- **Safari pinch** uses `gesturestart` / `gesturechange` / `gestureend`; the starting
  scale is remembered so each event applies the ratio since the previous event.
  Playwright cannot synthesise a `GestureEvent`, so the handler is covered by the
  component test TC-17 (the design says the same).
- **Keyboard** shortcuts listen on `window` for Ctrl/Cmd with `=`, `+`, `-`, `_` and
  `0`, and are ignored while focus is in a text field, `select`, `textarea` or a
  `contenteditable`. `preventDefault()` runs on every match so the browser's own
  page zoom never fires (TC-31 checks `visualViewport.scale` and `devicePixelRatio`).
- **Drag only starts on empty board space**: `pointerdown` is accepted when its target
  is the viewport itself, so later stories can put objects in the world layer and stop
  propagation. Pointer capture is best effort — engines refuse unknown pointer ids, and
  the drag must still end cleanly, so capture calls are wrapped and `lostpointercapture`
  also ends the drag.
- **The controls are not the board**: `ZoomControls` stops `wheel` and `pointerdown`
  propagation, so a Ctrl+wheel over the panel is left to the browser and never zooms
  the board (TC-30).

## State, hint and the test hook

- `hasNavigated` latches on the first *user* camera change and is never cleared;
  the system changes (first sizing of the window, the test hook) do not dismiss the
  hint. The camera and the hint are per-visit in-memory state, so a reload returns to
  the reset view and shows the hint again — which is what PRD `nav.hint` asks for
  ("... until the page is reloaded").
- **`window.__vidi6`** (`setCamera` / `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`; `setCamera` ignores non-finite or non-positive
  input. Verified by building both modes: the production bundle contains no `__vidi6`
  string, the test bundle does. Vite dead-code-eliminates the whole block in production.
- The viewport carries `data-camera-x/-y/-zoom`, `data-grid-spacing` and `data-mode`
  attributes. They are a cheap inspection surface: the tests measure the camera the
  same way the renderer sees it instead of duplicating the maths in the test.
- Accessibility: the buttons are real `button`s with the exact accessible names
  "Zoom out", "Zoom in", "Reset view", disabled at the limits (so a click there is a
  no-op, TC-32), and the zoom label is an `aria-live="polite"` output.

## Browsers I could not run here

`playwright.config.ts` declares **chromium, firefox and webkit** projects as the design
requires, but on this host only Chromium can actually launch: the Firefox and WebKit
binaries are installed, their **system libraries are not** (`libgtk-3.so.0`,
`libepoxy.so.0`, `libjpeg.so.8`, `libwebp.so.7`, `libharfbuzz-icu.so.0`, `libGLESv2.so.2`),
and installing them needs root, which this account does not have (`sudo` is blocked by
a no-new-privileges flag). Rather than fail the suite, the config probes the dynamic
linker's cache and skips an engine with a printed reason:

```
[e2e] skipping "firefox": the host is missing libgtk-3.so.0
[e2e] skipping "webkit": the host is missing libgtk-3.so.0, libepoxy.so.0, ...
```

`E2E_BROWSERS=chromium,firefox,webkit` overrides the selection. The specs use nothing
engine-specific (no Chromium-only APIs), so they should pass in Firefox and WebKit on a
machine that can start those browsers — that has not been verified here.

## Out of scope

Stories 6 and 13–17 (presence, offline device copies, sign-in, dashboard, comments,
export) are not implemented and nothing was added for them.
