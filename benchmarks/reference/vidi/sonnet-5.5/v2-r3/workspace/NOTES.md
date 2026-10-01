# Notes

## Story 1 decisions

- **Hook placement:** `BoardViewport` owns `useCamera` and renders `ZoomControls` and `NavigationHint` as siblings of the
  viewport element (inside `.board-root`). The design's contract gives `BoardViewport` only a `children` prop, so the
  camera cannot be lifted into `App.tsx`; `App.tsx` just mounts `BoardViewport`. Controls are not inside the wheel-listening
  element, so Ctrl-wheel over them never zooms the board (TC-30).
- **Extra hook members:** `useCamera` additionally returns `zoomByFactor` (Safari gestures) and `setCamera` (test hook).
- **Zoom limits vs. step snapping:** steps snap to `ZOOM_STEP_FACTOR^n` only within 1e-9; the clamped limits (10%, 400%) are
  not powers of 1.25, so stepping from a limit lands on the nearest unsnapped value.
- **Grid:** drawn as a CSS radial-gradient on the viewport; `background-position` is computed modulo the tile size so
  precision holds at ±1,000,000 units. Dots sit at world multiples of `GRID_SPACING_WORLD`.
- **Test hook:** `window.__vidi6.setCamera` only exists when `import.meta.env.MODE === 'test'`. e2e runs
  `npm run build:test` (vite `--mode test`) then `wrangler dev`; the normal `npm run build` does not contain the hook.
- **Browsers:** only Chromium is installed in this environment. `playwright.config.ts` adds the Firefox and WebKit
  projects only when their executables exist, so `npm run test:e2e` runs all three where available. Firefox/WebKit
  results were not verified here.
- Wheel `deltaMode` LINE/PAGE are converted to pixels (16 px per line, viewport size per page).
- `npm run test:e2e` overwrites `dist/client` with the test-mode build; run `npm run build` again before deploying.
- Task 1's red-phase commit was skipped; the camera maths was implemented together with its tests in the single story commit.

## Story 2 decisions

- **Camera plumbing:** `BoardViewport` still owns the camera, so it takes `children` as a function of the camera plus `onCreateAt`, `onEmptyClick` and an `apiRef` (`viewportCentreWorld()`); `useCamera` also returns `getCamera`.
- **`createSticky` returns `string | false`:** false for non-finite coordinates (TC-39), so the contract return type is widened.
- **DOM order vs stacking:** notes render in stable id order and stack with `z-index`; re-ordering the DOM mid-drag made the browser drop pointer capture and abort the drag.
- **Note toolbar** is rendered inside the note and counter-scaled by 1/zoom so it stays screen-sized.
- **Selection on drag:** a drag selects the note when it starts; a plain click selects on pointerup. Focusing a note with Tab also selects it.
- **Delete via keyboard** is handled in `App.tsx`, and it ends the selection immediately; vanished ids are also cleaned up by an effect.
- `useBoardDoc` accepts an optional existing `Y.Doc` (used by component tests). Styles for story 2 are in `src/client/sticky.css`.
- TC-37 "deleted while editing" is tested with a harness around `StickyNote` that deletes via the model. Only Chromium e2e was run.

## Story 3 decisions

- **vitest pinned to ^4.1:** `@cloudflare/vitest-pool-workers` (0.22) only supports vitest 4; with vitest 5 the pool fails to start. Root `vitest` was downgraded to `^4.1.0`; unit and component suites are unaffected.
- **compatibility_date `2026-08-01`:** the workerd bundled with the pool does not accept `2026-09-01`.
- **Two tsconfigs:** `tsconfig.json` (DOM, client + unit/component/e2e) and `tsconfig.worker.json` (workers types; `src/worker`, `src/shared`, `tests/integration`). `npm run typecheck` runs both.
- **Update validation in `BoardRoom`:** y-protocols' `readSyncMessage` swallows update errors, so the room decodes sync sub-messages itself and applies updates with `Y.applyUpdate` inside a try, so a bad update closes that socket with 1003.
- **Remote text while editing (design gap):** `StickyTextEditor` was uncontrolled and never reflected remote changes, so the next keystroke would delete other people's characters. It now observes the `Y.Text`, updates the textarea for non-local transactions and maps the caret through the delta (`transformIndex`). If merged text exceeds `STICKY_TEXT_MAX_CHARS`, the next local edit clamps it (story 2 limit wins).
- **`useBoardDoc(existing?, boardId?)`:** the board id is a second argument so component tests that pass a doc stay unchanged; without a board id the doc stays local. It also returns `connection`. `App` keys the board on the id; paths other than `/b/<valid id>` are replaced with a fresh `/b/<newBoardId()>`.
- **`connectBoard` takes an optional provider factory** (4th arg) so component tests drive the status mapping with a fake provider. `window.__vidi6.connectionState` is published in test builds only.
- **Offline in e2e:** Chromium's `context.setOffline` does not close an open WebSocket, so the e2e helper proxies sockets with `page.routeWebSocket` and closes/refuses them when a participant goes offline (plus `setOffline`).
- **Restart simulation (TC-18):** a fresh Durable Object is a different board id; the old docs seed the clients, mirroring browsers that stayed open.
- **Nightly e2e:** TC-29/TC-30 live in `tests/e2e/nightly/` and run with `npm run test:e2e:nightly` (`NIGHTLY=1`); they are excluded from `test:e2e`. Firefox/WebKit are not installed here; only Chromium was run.
- The status badge is a `div role="status"`; the zoom `<output>` is also a status role, so e2e targets `.connection-status`.
