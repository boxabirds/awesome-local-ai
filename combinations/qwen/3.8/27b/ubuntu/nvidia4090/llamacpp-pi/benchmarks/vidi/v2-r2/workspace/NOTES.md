# Story 1: decisions and environment notes

## Environment

- **E2E runs on Chromium only.** The sandbox pre-installs only the
  Chromium Playwright browser (`chromium-1243` + headless shell) under
  `~/.cache/vidi-agent-ms-playwright`; Firefox and WebKit binaries are not
  present and cannot be downloaded (no network to the Playwright CDN, no
  root). `playwright.config.ts` therefore keeps all three projects per the
  design, and `npm run test:e2e` selects the `chromium` project
  (`playwright test --project chromium`). On a machine with all three
  browsers, `npx playwright test` would run everything.
- **`scripts/ensure-browsers.mjs`** runs before the e2e suite and makes
  `PLAYWRIGHT_BROWSERS_PATH` work no matter how the environment sets it: it
  keeps the current value when it contains a Chromium binary, otherwise
  falls back to the sandbox cache locations.
- **Ports.** All servers stay inside `$AGENT_PORT_FIRST..$AGENT_PORT_LAST`
  (defaults 29104-29119): `vite dev` on 29104, the e2e `wrangler dev`
  webServer on 29105 (config asserts the port is in range).

## Implementation decisions

- **CameraContext.** `useCamera` lives in `App` (which also owns the
  viewport size) and is provided via `CameraContext`; `BoardViewport`
  consumes it. This keeps the viewport's public API as `{children}` while
  the board input, zoom controls and hint all drive the same camera.
- **rAF coalescing.** Every camera mutation is enqueued and applied once
  per animation frame (`useCamera`), so fast wheel/drag bursts cause at
  most one render per frame. `endPan` flushes synchronously so a drag ends
  on the exact pointer position.
- **ZoomControls enabled-guards.** Buttons carry the native `disabled`
  attribute and additionally check `canZoomIn/Out` before calling their
  callbacks, keeping the design contract ("call callbacks only when
  enabled") true even for synthetic events (jsdom fires `click` on
  disabled elements — TC-32).
- **`setPointerCapture` guard.** Called only when available (jsdom lacks
  it; every supported browser has it).
- **Test hook.** `window.__vidi6.setCamera` is installed only when
  `import.meta.env.MODE === 'test'`; verified absent from the production
  bundle (`grep __vidi6 dist/client/assets/*.js` → 0 matches).
- **E2E pixel target.** The origin marker is a 12px world-space crosshair
  centred on (0,0); its centre is exactly `worldToScreen(0,0)`, so
  movement assertions are ±1px camera assertions. TC-27/TC-26 travel to
  `UNBOUNDED_PAN_TESTED_EXTENT` via the test hook; the marker's layout box
  is readable even far off-screen.
- **TC-18 (keys)** is tested in `BoardViewport.test.tsx`: the Ctrl/Cmd
  keydown listener lives on `window` inside BoardViewport. (The design
  lists TC-18 under both the BoardViewport and ZoomControls test files.)

## Component-test environment quirks (handled in `tests/component/setup.ts`)

- **No `PointerEvent` in jsdom** — a minimal `PointerEvent` (over
  `MouseEvent`, adding `pointerId`/`pointerType`) is installed so
  Testing Library's pointer events carry `clientX/Y`/`button`.
- **No `requestAnimationFrame` without `pretendToBeVisual`** — a
  timer-based fallback is installed; under `vi.useFakeTimers()` the
  underlying `setTimeout` is faked, so tests advance 16ms in `act` to
  flush the coalesced camera update.
- **RTL `fireEvent` returns `dispatchEvent`'s boolean**, not the event;
  tests that assert `defaultPrevented` build the event with
  `createEvent` and dispatch it with `fireEvent`.
- **RTL auto-cleanup needs vitest globals** (off here), so `cleanup` runs
  in an explicit `afterEach`.
