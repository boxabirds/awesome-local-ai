# Story 1 — Notes

Decisions and deviations made while implementing this story.

## E2E browsers: Chromium and Firefox (WebKit not runnable here)

The design asks for the e2e suite to run on Chromium, Firefox and WebKit, and
`playwright.config.ts` defines all three projects. In this environment only
Chromium and Firefox can actually launch:

- Playwright's WebKit (minibrowser) bundles almost all of its libraries, but it
  still needs the system `libavif.so.13`.
- This machine has no root access (`sudo` is disabled by no-new-privileges),
  and the egress proxy blocks the package mirrors (`archive.ubuntu.com`,
  `deb.debian.org`, `launchpad.net` all return 403), so the `.deb` cannot be
  fetched or installed.

Therefore:

- `npm run test:e2e` runs the two launchable browsers:
  `playwright test --project=chromium --project=firefox`.
- `npm run test:e2e:all` (`playwright test`) runs all three projects for
  fully provisioned environments (e.g. after `npx playwright install-deps`).

All e2e assertions are browser-agnostic (no Chromium-specific APIs), so the
WebKit project is expected to pass once its system dependency is available.

## Manual browser checks (task 3 "Done when")

The environment is headless, so the manual Chrome/Safari check was covered by
automation instead:

- Chrome-class behaviour: real-Chromium e2e (pointer drag, wheel pan,
  Ctrl-wheel zoom, keyboard shortcuts, page-zoom invariance, exact pixel
  movement).
- Safari pinch: Playwright cannot synthesise Safari gesture events; the
  `gesturestart`/`gesturechange` handler is covered by the TC-17 component
  test (jsdom) — also noted as "Not covered" for e2e in the design strategy.

## Test-build camera hook

- `window.__vidi6` is installed only when `import.meta.env.MODE === "test"`
  (`src/client/canvas/testHooks.ts`).
- `npm run build:e2e` builds with `--mode test` so the e2e web server
  (`wrangler dev` on port 29540) serves a build that includes the hook;
  `npm run build` (production mode) excludes it — verified by the build size
  diff and by `vite build` dead-code-eliminating the guarded branch.

## Ports (constraint: 29536–29551)

- `npm run dev` (Vite dev server): 29536.
- e2e web server (`wrangler dev --local`): 29540.
- No other long-running servers are started.

## Implementation notes

- **Camera state** lives in `useCamera` (React state + refs) and is coalesced
  through `requestAnimationFrame` (at most one render per frame). The
  `hasNavigated` latch flips only when a camera maths call returns a *new*
  object, so clicks without movement and no-op zooms at a limit do not
  dismiss the first-use hint (TC-29).
- **Initial view** centres the world origin on first non-zero viewport size;
  this does not count as navigation.
- **Zoom stepping** snaps to the nearest `ZOOM_STEP_FACTOR^n` within a named
  relative epsilon, which keeps label values on the 100→125→156→…→400
  sequence and lets the clamping step land exactly on `ZOOM_MAX`.
- **Wheel deltas**: `deltaMode` LINE/PAGE values are converted to pixels with
  named constants (16 px/line, 100 px/page). Ctrl/Meta wheel zooms by
  `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)` around the pointer; plain wheel pans.
  Every wheel event over the board is `preventDefault`-ed, so page zoom never
  changes (TC-15/16, TC-24, TC-31).
- **E2E determinism**: because camera updates land on the next animation
  frame, DOM pixel assertions first wait for the rendered state to settle
  (zoom label text, world-layer `transform`, or the camera hook) before
  measuring — this avoids rAF races without using sleeps.
- **TC-32 (disabled button)** uses `user-event` with real timers:
  `user-event` correctly ignores clicks on `disabled` buttons (unlike
  `fireEvent`), and fake timers would hang `user-event`.

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (client bundle in `dist/client`).
- `npm run test:unit` — 14 passed (TC-01…TC-12 + property check).
- `npm run test:component` — 13 passed (TC-13…TC-22, TC-29, TC-30, TC-32).
- `npm run test:e2e` — 8 passed (4 cases × Chromium + Firefox).
