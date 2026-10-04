# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Stack versions
- Vite 8 + @vitejs/plugin-react 6 + React 19, Vitest 5 (projects `unit`/`jsdom`
  `component`), Playwright 1.63, Wrangler 4 (assets-only Worker config; the Worker
  `main` arrives in story 3).
- `typescript` is pinned to `~5.9.3` rather than the current `7.x`. TypeScript 7 is
  the new native (Go) compiler; `tsc --noEmit` from 5.9 is the compiler the rest of
  the tool chain (and later stories) is written against, so it is the safer pin.
  Nothing in the source depends on the compiler version.

## Ports
All servers are pinned to ports inside `$AGENT_PORT_FIRST`-`$AGENT_PORT_LAST`
(22880-22895), which the harness requires:
- `22880` `wrangler dev` (e2e static assets), `22881` its inspector/devtools port
  (`playwright.config.ts` and `npm run worker:dev`). Playwright takes the first free pair
  in the range when 22880 is already held, and stays inside the range either way.
- `22884` `vite preview`, `22885` `vite` dev server (`vite.config.ts`).

## Shared camera state
The design gives `useCamera(viewport: Size)` the camera state *and* gives
`BoardViewport` only a `children` prop, while `App.tsx` wires `ZoomControls`,
`NavigationHint` and `BoardViewport` together. Two separate `useState` calls could
not share a camera, so `useCamera` is backed by one module-level camera store
(subscribe/getSnapshot via `useSyncExternalStore` + coalesced `requestAnimationFrame`
emits). `useCamera` is a thin subscription over that store, so every caller sees the
same camera and every handler is a stable function. The store is in-memory only
(nothing is persisted, per the PRD). `src/client/canvas/cameraStore.ts` holds it;
`useCamera.ts` re-exports the hook. That extra file keeps the store testable in
isolation and is the only file added to the design's layout.
- Initial camera = `resetCamera(initial viewport)` where the initial viewport is the
  window size, so the board opens with its starting point centred and a resize that
  happens before the first `ResizeObserver` callback does not move it.
- `useViewportSize(ref)` is exported from `useCamera.ts` (design lists only
  `useCamera` there) and is shared by `App` and `BoardViewport`; it falls back to the
  window size when the measured box is zero (jsdom reports zero rects).

## Wheel delta modes
`deltaMode` LINES/PAGE is converted to pixels with the named settings
`WHEEL_LINE_PX` and `WHEEL_PAGE_VIEWPORT_FRACTION` added to
`src/shared/config.ts` (the design's six named settings are all present and
unchanged).

## Grid / origin marker measurement in tests
The dot grid is a CSS `radial-gradient` background on the viewport element
(`background-size = GRID_SPACING_WORLD * zoom`,
`background-position = (-x * zoom) mod spacing`), so a grid dot's on-screen position
is exactly `background-position + n * background-size`; e2e tests read those computed
values rather than sampling pixels. The origin marker is a 24x24 CSS crosshair whose
*centre* is at world (0, 0) with a counter-`scale(1/zoom)` so it keeps a constant
on-screen size; its `getBoundingClientRect()` centre therefore equals
`worldToScreen(camera, {0, 0})` exactly, which is the stable pixel target TC-23/24/26
need.
For TC-27 (1,000,000 units away) the marker sits ~2,000,000 px off screen. What is
still exact there is the camera (read through the documented
`window.__vidi6.getCamera()` fixture) and the *difference* between two
`getBoundingClientRect()` readings, which the test uses to show a 200/100 drag moved
the content by 200/100 px. What is not exact is the *rendered* CSS text: browsers
serialize an inline `transform`/`background-size` with about six significant digits
(`translate(-1.00436e+06px)` for `-1004364.97px`), so e2e comparisons of rendered
values use a tolerance that grows with the number (see `serializationTolerance` in
`tests/e2e/helpers/board.ts`), while exactness of the maths itself is asserted on the
camera and on the grid geometry.

## Test hook
`window.__vidi6.getCamera()/setCamera()` is installed only when
`import.meta.env.MODE === 'test'`, i.e. by `npm run build:test`
(`vite build --mode test`). `npm run test:e2e` builds that way *before* invoking
Playwright, so the suite cannot be fooled by the `wrangler dev` it reuses
(`reuseExistingServer`) still serving an older bundle off disk - which is what
happened once a previous run left a `workerd` behind on port 22880. `src/client/canvas/testHooks.ts` is unreachable in a production
build (the call site is inside an `import.meta.env.MODE === 'test'` branch, which the
bundler folds away), so `__vidi6` never exists in production.

## jsdom gaps filled by tests/component/setup.ts
jsdom has no `PointerEvent`, no `setPointerCapture`/`releasePointerCapture`, no
`ResizeObserver`, and `getBoundingClientRect()` is all zeros. The component-test setup
installs small standards-shaped shims for these (a `PointerEvent` extending
`MouseEvent`, capture methods that track ids on the element, a `ResizeObserver` that
reports the window size once on `observe`) and makes `requestAnimationFrame` a
`setTimeout(0)` so the store's per-frame coalescing flushes inside
`await waitFor(...)`. Component tests that assert `defaultPrevented` construct the
event explicitly and dispatch it, because React's own `onWheel` would be passive -
the component under test registers a real non-passive listener, which is what the
tests verify.

## Keyboard shortcuts
`Ctrl/Cmd + =` (also `+`), `Ctrl/Cmd + -` (also `_`) and `Ctrl/Cmd + 0` are handled on
`window` and `preventDefault`ed so the browser page zoom never changes (PRD
`zoom.no_page_zoom`). Shortcuts are ignored while focus is in a text field
(`input`, `textarea`, `select` or `contenteditable`) so later stories can type on the
board; no such element exists in story 1.

## e2e: waiting for the render

The camera store coalesces its notifications into one animation frame, so the DOM is
always up to one frame behind the camera. That shows up in tests as a stale
percentage label or a zoom button whose `disabled` attribute has not landed yet -
Playwright then waits for a disabled button to become enabled and times out. Every
e2e measurement therefore goes through `settled(page)`
(`tests/e2e/helpers/board.ts`), which waits until the world layer transform, the
percentage label, the two buttons' `disabled` state and the grid size all match the
camera the page holds. That doubles as an assertion of the PRD's "the controls reflect
the zoom" requirements.

## Firefox in this sandbox

Firefox 155 (Playwright 1.63's build) aborts with SIGABRT during startup in this
sandbox - reproducible without Playwright (`firefox -no-remote -headless -profile ...
about:blank`), independent of profile location, `HOME`, and the
`MOZ_DISABLE_*_SANDBOX` escape hatches, while `firefox -version` works. Chromium and
WebKit start fine. Rather than let that read as a broken board, the Firefox project
is added only when a one-off launch probe succeeds; the probe result is cached per
Playwright version in `.ua/firefox-launch.json` (gitignored), logged on every run, and
overridden with `VIDI6_FIREFOX=1`/`=0`. The board is therefore verified in Chromium
and WebKit on this machine, and in all three engines wherever Firefox can start.

## wrangler.jsonc

An assets-only Worker may not declare an assets `binding` - wrangler refuses to start
("Cannot use assets with a binding in an assets-only Worker") - so the config sets
`assets.directory` and no
binding; the Worker script and its `ASSETS` binding arrive with story 3's routes.
`inspectorPort` is not a `dev` config key either, so the inspector port is passed as
the `--inspector-port` flag (in `playwright.config.ts`'s webServer command and in
`npm run worker:dev`), inside the allocated port range.

## Running the e2e suite

`npm run test:e2e` builds the client with `vite build --mode test` first, then starts
Playwright, whose `webServer` is `wrangler dev` on the first free port in the allocated
range serving `dist/client` (see the story 2 note below).
Two details that cost real debugging time:

- The webServer command is wrangler itself, not `npm run wrangler dev ...`: behind
  `npm`, the shutdown at the end of a run leaves the workerd process alive, holding
  22880/22881, and the next run either reuses it or fails to bind. wrangler reads the
  assets directory into memory at startup (its watcher hit a macOS file-descriptor
  limit here), so a server that predates a build serves the bundle it started with -
  which is why the test build happens before Playwright launches and why `openBoard`
  checks for `window.__vidi6` before asserting anything about the board.
- `wrangler.jsonc` deliberately has no `not_found_handling: single-page-application`:
  with it, a request for a bundle that is not on disk gets index.html back with a 200,
  and the app simply never boots. Story 1 has one route, so the rewrite buys nothing.

## Story 2: two drag bugs that only a real browser could find

Both survived 71 unit tests and 83 jsdom component tests, and both were caught by the
e2e suite on the first run. They are worth writing down because the jsdom tests were
not wrong, they were just not the place where either bug can show.

1. **`moveObject` returning `false` ended the drag.** `false` from the model means
   either "no such object" or "already at that position" (the second exists so a drag
   does not write a no-op to the undo log every frame). The note took that as "the
   note is gone", dropped its drag state, and stopped following the pointer after the
   first frame that had nothing new to write. Now the drag only lets go when the
   document itself is gone, which is what the unmount of the note actually means.
2. **Raising a note took it out of the document.** `bringToFront` changes `z`, and
   `snapshot()` lists notes in stacking order, so the raised note became the last of
   the React children - React moved that DOM node, and Chromium releases pointer
   capture when the captured element is pulled out of its place. The note jumped by
   the pointer moves that had already arrived and then stayed put: a drag of 100 screen
   pixels delivered 10. A jsdom test cannot see this, because it dispatches one
   `pointermove` per drag and jsdom has no pointer capture to lose. Now the notes are
   rendered in the order they were created and stacked with `zIndex: note.z`, so being
   raised is a style change and the note is never moved in the document while held.
   `bringToFront` still happens once, when the drag starts, as the design says.

Consequence for the tests: "which note is on top" is a computed-style question, not a
DOM-position one. `paintedIds` in `tests/e2e/helpers/sticky.ts` sorts by `z-index` with
document order as the tie-break, which is how the browser itself decides.

## Story 2: the e2e port is picked, not pinned

The design's test matrix for this story has no reload or two-browser test - "No network
or storage in this story", persistence is story 4 - so the e2e file covers TC-30 to
TC-34 and the notes' keyboard reach, and TC-39 stays a unit test.

`playwright.config.ts` now uses the first free pair of ports inside the allocated
range instead of 22880 outright. The reason is a runtime that cannot be stopped: a
workerd left behind by an earlier session owns 22880, answers `/` out of the snapshot
it read at startup and 404s the bundle the current run built, so every test fails with
"window.__vidi6 is missing". A new sandbox cannot kill it - `ps` and `pgrep` are refused
(`EPERM`), `lsof -ti:22880` sees nothing, and while `netstat -anv -p tcp` does show the
pid, `kill -9` on it leaves wrangler in another process simply starting another runtime
on the same port. When the ports are free, as they are in a clean checkout, the chosen
pair is 22880/22881 and nothing about a run changes.

The choice is published in `VIDI6_E2E_PORT`/`VIDI6_E2E_INSPECTOR` and read back from the
environment, because the config file is evaluated again in every Playwright worker and a
port that is free in the parent is already taken by this run's own server in the worker -
each worker then started its own server on another port and tested nothing.

While here: the note above about `wrangler.jsonc` was wrong. The config sets
`assets.directory` and deliberately no `not_found_handling`; the flag and the inspector
port are passed on the command line.
