# Notes — decisions & deviations

## Story 1: Pan and zoom around an infinite board

### Stack / versions
- Vite 6 + React 19 + TypeScript client. Playwright pinned to the version whose
  bundled browser revisions match the machine cache (chromium-1243, firefox-1543,
  webkit-2359) so no browser download is needed. `PLAYWRIGHT_BROWSERS_PATH` is
  already exported in the environment.
- esbuild/workerd postinstall scripts are blocked by the sandbox's allow-scripts
  hook, but the platform binaries install via their optional
  `@esbuild/darwin-arm64` / `@cloudflare/workerd-darwin-*` deps, so Vite, Vitest
  and `wrangler dev` work without running those scripts.

### Ports (all inside $AGENT_PORT_FIRST..LAST = 25232..25247)
- `wrangler dev` app: 25232; wrangler inspector: 25233.
- Vite dev server: 25234; Vite preview: 25235 (strictPort).

### Architecture decision — sharing camera state (design contract tension)
The design lists `useCamera(viewport)`, `BoardViewport({ children })`,
`ZoomControls({props})` and `NavigationHint({ visible })` as separate exported
interfaces, and says App wires them together. To keep `BoardViewport`'s public
prop shape to just `{ children }` (so the world layer can later hold object
children transformed with the camera, while the fixed-position controls must
live outside the CSS transform), the camera state is provided to the component
tree through a small React context (`BoardCameraProvider` + `useBoardCamera`)
that owns `useCamera` and the `ResizeObserver`-measured viewport `Size`. This is
an addition to `useCamera.ts` exports, not a change to any listed signature.
- `BoardViewport` reads the context and attaches the measured viewport ref.
- `App.tsx` renders connector components that read the context and pass the exact
  props the design specifies to `ZoomControls` / `NavigationHint`.

### Grid background-position modulo
Design text writes `background-position = -x*zoom mod spacing`; the correct value
is `mod (spacing*zoom)` (they coincide at zoom = 1). Implemented as
`-x*zoom mod (GRID_SPACING_WORLD*zoom)` so the dot spacing on screen always equals
`GRID_SPACING_WORLD*zoom` at any zoom. Noted in NOTES only; not a behaviour change.

### Test-only hooks
`window.__vidi6 = { setCamera, getCamera }` is installed only when
`import.meta.env.MODE === 'test'`. `npm run build:test` (`vite build --mode test`)
produces the client served to Playwright so the hooks exist in e2e. `npm run build`
(production) omits them. `getCamera` was added (in addition to the design's
`setCamera`) so component/e2e tests can assert camera state without parsing CSS
matrix transforms.

### rAF batching in tests
Camera commits are coalesced with `requestAnimationFrame`. Component tests flush a
frame deterministically with `await act(async () => { await new Promise(r =>
requestAnimationFrame(r)) })` (real rAF from jsdom) rather than fake timers —
simpler and still deterministic.

## Implementation refinements (tasks 3-7)

### All viewport input uses native `addEventListener`, not React `on*` props
pointer / wheel / gesture / keyboard handlers are attached in a single effect via
`addEventListener` (`wheel` with `{ passive: false }` so `preventDefault` can stop
native page zoom). React's synthetic `onPointerDown` handlers did **not** fire
reliably under jsdom, and native listeners give one consistent path for real
browsers and jsdom tests.

### jsdom has no `PointerEvent` constructor
Component pointer-drag tests dispatch a plain cancelable `Event('pointerdown'|…)`
and assign the fields the handlers read (`button`, `pointerId`, `clientX`,
`clientY`) — helper `dispatchPointer` in `tests/component/util.ts`. The production
code still uses real `PointerEvent`/`setPointerCapture` in the browser.

### wrangler assets-only config
`wrangler dev` for a static-assets-only Worker **rejects** an `assets.binding`
(`Cannot use assets with a binding in an assets-only Worker`), so `binding: "ASSETS"`
was removed from `wrangler.jsonc`. `main` stays `worker/src/index.ts` (added in
story 3). Serving works: `wrangler dev --ip 127.0.0.1 --port 25232
--inspector-port 25233` returns the SPA (200) and its hashed JS assets.

### E2E page-zoom assertions
Playwright cannot hold a keyboard modifier while synthesising a real wheel across
browsers, and OS/browser-level zoom is not observable in headless, so TC-24/TC-31
dispatch a cancelable `WheelEvent` with `ctrlKey:true` at a client point (exercises
the handler under real CSS layout) and assert `window.visualViewport.scale === 1`
and unchanged `devicePixelRatio` as the "page not zoomed" signal. TC-15/16/17/18
(component) already assert `event.defaultPrevented` directly.

### Browser engines — Firefox & WebKit could NOT be launched in this environment
All three Playwright projects are configured (`chromium`, `firefox`, `webkit`,
each pinned to a 1280×800 viewport at `deviceScaleFactor: 1`). On this host
(macOS 26.4, build 25E246, Playwright 1.63.0) the Chromium project runs green
(7/7). The cached **Firefox** and **WebKit** binaries abort immediately on launch
— this is an environment limitation, not a skipped/disabled test:

- Firefox: `…/firefox-1543/.../MacOS/firefox -headless …` → `<process did exit:
  signal=SIGABRT>` (`Abort trap: 6`).
- WebKit: `…/webkit-2359/pw_run.sh …` → `Abort trap: 6` (exit code 134).

Both were re-fetched via `playwright install firefox webkit` (no change). The
engines were not removed or excluded from the config, so `npm run test:e2e` still
attempts all three; only Chromium executes successfully here.

**Suggested next steps** (to actually run Firefox/WebKit): use a host OS supported
by Playwright 1.63's Firefox/WebKit builds (e.g. a GA macOS release or a supported
Linux distro) and run `playwright install --with-deps`, or bump/downgrade
Playwright to a build whose WebKit/Firefox are compatible with macOS 26.4. No
sudo/system changes were attempted (the task forbids installing packages).

## Verification gotcha (this sandbox)
`pgrep`/`pkill` do not work here (”sysmon request failed… Cannot get process
list”), so leftover `wrangler` servers cannot be killed that way. Because the
Playwright `webServer` uses `reuseExistingServer`, running `npm run build`
(production, no test hook) just before the e2e could leave a reused server serving
a hook-less bundle, making every e2e time out waiting for `window.__vidi6`. Make
sure the allocated ports (25232/25233) are free (”lsof -nP -iTCP:<port>
-sTCP:LISTEN -t -> kill -9”) and run e2e against a freshly built **test** bundle.
With that, `playwright test --project=chromium` is green (7/7).
