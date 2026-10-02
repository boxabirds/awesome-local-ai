# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Stack versions
- Vite 7 + @vitejs/plugin-react 5 + vitest 4 (mutually compatible peer ranges).
  React 19, TypeScript 5.7. Playwright 1.63 (the three browsers already present
  on this machine — chromium-1243, firefox-1543, webkit-2359 — match 1.63).
- `npm install` on this machine runs behind an `allow-scripts` policy that skips
  `esbuild`/`workerd` postinstall scripts, but the platform binaries are already
  present and both Vite and `wrangler dev` run, so this is not a blocker.

## Component / wiring architecture (small deviation from the design's prop lists)
- `App.tsx` owns `useCamera(viewport)` and the `ResizeObserver`-measured viewport
  size, and passes camera + intent callbacks down. The design shows
  `BoardViewport({ children })` and `ZoomControls`/`NavigationHint` as leaf
  components wired in `App`; to keep a single camera instance shared by the
  viewport surface and the controls without inventing a new context file that is
  not in the prescribed layout, `BoardViewport` additionally accepts `camera` and
  handler props. Its DOM-event wiring (pointer / non-passive `wheel` / Safari
  `gesture*` / window `keydown`) lives inside `BoardViewport` exactly as the
  design describes; it is otherwise presentational.
- `useCamera` keeps the source of truth in refs and only calls `setState` when a
  camera mutation returns a *new* object, so no-op inputs (a click without
  movement, a zoom at a limit) never re-render and never latch `hasNavigated`
  (required by TC-29 / nav.hint).
- Camera updates are plain React `setState` calls (React batches per event)
  rather than an explicit `requestAnimationFrame` coalescer, so component tests
  are deterministic without timer plumbing. React already coalesces the multiple
  updates a single gesture event can produce; wheel/pinch events fire discretely
  and render once each. Noted as the one intentional omission from the design's
  implementation notes.

## Safari gesture mapping
`useCamera`'s contract exposes only `wheel(e)` (no separate gesture method), so
`BoardViewport` maps a Safari `gesturechange` scale onto the pinch path by
passing `deltaY = -ln(scale) / WHEEL_ZOOM_SENSITIVITY` with `ctrlOrMeta: true`;
`zoomAt` then receives exactly `scale` as its factor. Behaviour is identical to
the design's "zoomAtPointer scale ratio".

## Origin marker
Rendered in all builds as a 0x0 element at world (0,0) inside the world layer, so
`getBoundingClientRect()` is exactly `worldToScreen(0,0)` at any zoom. A visible
red crosshair is counter-scaled by `1/zoom` so it stays a constant on-screen size
while remaining a stable pixel target for e2e (TC-23 / TC-24 / TC-26).

## Test-mode hook
`window.__vidi6.setCamera/getCamera` is installed only when
`import.meta.env.MODE === 'test'` (`src/client/canvas/testHooks.ts`). e2e builds
with `vite build --mode test` so the hook is present; `npm run build` (production)
contains zero `__vidi6` references (verified).

## E2E serving & ports
`npm run test:e2e` = `vite build --mode test` then Playwright, whose `webServer`
is `wrangler dev` serving `dist/client` (static-asset path the story-3 Worker
will reuse). Servers bind the allotted agent ports only. `reuseExistingServer`
is disabled and the build runs before the server starts, because `wrangler dev`
here disables its assets directory watcher past the platform watch limit, so a
reused process could otherwise serve stale hashed asset filenames after a rebuild.

### Browsers (environment limitation)
Chromium, Firefox and WebKit binaries are all present, but **only Chromium can
actually launch in this sandbox** — Firefox aborts with "Failed to launch the
browser process" and WebKit exits `Abort trap: 6` on `browserType.launch()`
(reproduced with a bare `firefox.launch()` / `webkit.launch()` script). Per the
story rules, Chromium is therefore sufficient here. The three Playwright projects
are all defined; the run defaults to Chromium and the other two are enabled on a
capable machine with `E2E_BROWSERS=chromium,firefox,webkit npm run test:e2e`.
No test cases were removed or weakened for this.

### Port budget
This sandbox will not let the agent list or kill processes, and workerd child
processes survive their parent, so each `wrangler dev` run leaks its two ports.
The remaining allotted ports were used one run at a time; the committed config
points at ports that were free during the final green run.

## e2e interpretation note
TC-24 "zoom over a dot" is verified by hovering the pointer over the origin
marker (a distinctive, locatable grid feature) and asserting it stays under the
pointer ±1px while `visualViewport.scale` stays 1; dots are a CSS background
pattern with no individual element to track.
