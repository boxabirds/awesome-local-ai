# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions taken where the spec was silent or ambiguous:

1. **Camera ownership / BoardViewport props.** The design gives `BoardViewport` only `children` but
   also says `App.tsx` wires `ZoomControls` to `useCamera`. `App` calls `useCamera` and shares the
   result with `BoardViewport` through a small React context (`src/client/canvas/BoardContext.ts`);
   `BoardViewport` reports its measured size back through the same context (ResizeObserver).
2. **Initial view.** The board opens at `resetCamera(viewport)` (100%, start point centred), so
   "Reset view" on an untouched board is a no-op and does not dismiss the hint.
3. **Hint dismissal.** Any camera change that produces a new camera (pan, wheel, pinch, step,
   reset that actually moves) dismisses the hint; no-op actions (click without moving, zoom at a
   limit, reset when already reset) do not. The `window.__vidi6.setCamera` test hook does not count
   as navigation.
4. **`useCamera` API is a superset of the contract.** Added `isPanning` (drives the grab/grabbing
   cursor and `data-state`) and `zoomBy(point, factor)` (Safari pinch).
5. **Grid coarsening at low zoom.** Below ~33% the dots would be closer than 8 CSS px (2.4 px at
   10%), which is unreadable and costly to paint. The grid then shows every 2nd/4th… dot
   (`GRID_MIN_SCREEN_SPACING` in `src/shared/config.ts`). At 100% and above the spacing is exactly
   `GRID_SPACING_WORLD * zoom`. Dots sit on world multiples of the spacing, so the start point is a dot.
6. **Extra named settings** in `src/shared/config.ts`: `GRID_MIN_SCREEN_SPACING`,
   `GRID_DOT_RADIUS_PX`, `WHEEL_LINE_HEIGHT_PX`.
7. **Shift + mouse wheel** pans horizontally when the OS has not already converted it to `deltaX`.
8. **Keyboard shortcuts** are handled on `window` (the board fills the window and nothing else
   takes keyboard input yet). `Ctrl/Cmd + =` also accepts `+` and numpad +/−/0.
9. **Test hook.** `window.__vidi6` (`getCamera`, `setCamera`) is installed only when
   `import.meta.env.MODE === 'test'`; the production bundle does not contain it (checked).
   `npm run test:e2e` builds with `vite build --mode test` into `dist/client` and serves it with
   `wrangler dev`, so run `npm run build` again afterwards before deploying.
10. **E2E ports and browsers.** The e2e server port defaults to 8795 and is overridable with
    `E2E_PORT`. Browsers default to chromium, firefox, webkit and can be narrowed with
    `E2E_BROWSERS=chromium` (all three launch on the build machine at the time of writing).
11. **Commit granularity.** Task 1 asks for a red-phase commit; the harness asks for one commit
    per story, so the red phase (tests failing only with "not implemented") was verified locally
    and everything was committed once as `story 1: …`.
12. **Toolchain versions** resolved by npm at install time: React 19.3, Vite 8, Vitest 5,
    TypeScript 7, Playwright 1.63, Wrangler 4.

### Not covered (per design "Not covered")
- Smoothness/frame rate, real trackpad hardware differences and real Safari pinch are manual checks
  only; TC-17 covers the GestureEvent handler logic.
- TC-33 (shortcuts while focus is in the address bar) cannot be observed in-page.
- Very-far-away *objects*: the world layer uses a CSS transform with large translations; browsers
  composite in single precision, so objects (from story 2) a million units away may be off by a
  fraction of a pixel at high zoom. The dot grid is computed modulo the spacing and is exact.

## Story 2 — Capture ideas on sticky notes and rearrange them

Decisions taken where the spec was silent or ambiguous:

1. **`createSticky` with non-finite coordinates** returns `''` (no id) and opens no transaction.
   The contract returns `string` and says the model never throws for user input, so an empty
   id is the rejection signal. `moveObject` to the note's current position is also a no-op
   (`false`, no update), as is `setStickyColor` to the current colour.
2. **Model additions (superset of the contract):** `hasObject`, `observeObjects`,
   `isDetachedText`, `isStickyColor`, `SCHEMA_VERSION` in `src/shared/board-model.ts`.
3. **DOM order vs stacking.** Rendering notes in `(z, id)` order made React *move* the dragged
   note's DOM node when `bringToFront` ran, which drops pointer capture and ended every drag of
   a note that was not already on top (found by e2e TC-32). Notes are therefore rendered in a
   stable order (by id) and stacked with `z-index = z`; equal `z` falls back to DOM order, which
   is by id, so the visual order still matches `snapshot()`'s `(z, id)` order.
4. **Note toolbar placement.** Because every note has its own z-index (stacking context), the
   floating toolbar is rendered through a React portal into the world layer, at the note's top
   centre, scaled by `1/zoom` so it keeps its screen size (`NOTE_TOOLBAR_GAP_PX` above the note).
5. **Starting a drag selects the dragged note** (single selection), so another note's toolbar
   does not stay visible while dragging; the toolbar of the dragged note appears on release.
6. **Pasting over the limit in the middle of text** drops the excess from the end of the
   *inserted* text (`clampAtCaret`), never the text after the caret. Pasting at the end is
   exactly `clampToLimit`. The caret is placed at the end of the kept inserted text.
7. **Clicking outside while editing** is detected by a capturing `pointerdown` listener on
   `document` installed by `StickyTextEditor` (it also covers the left toolbar and zoom
   controls). Panning the board by dragging empty space keeps the selection; only a click
   (press and release within `DRAG_THRESHOLD_PX`) clears it.
8. **Keyboard.** Tab focus on a note selects it; Enter on the selected note edits it; Enter and
   Delete are ignored while focus is on a button (e.g. a swatch), in a text field or while
   editing. Escape returns focus to the note.
9. **Remote text changes while editing** (story 3) are already reflected in the open textarea
   with the caret shifted across the change.
10. **Extra named settings:** `STICKY_PADDING_WORLD`, `STICKY_LINE_HEIGHT`,
    `NOTE_TOOLBAR_GAP_PX`. The toolbar's z-index is a named constant in `StickyNote.tsx`.
11. **`App` takes an optional `doc` prop** so component tests can drive and inspect a real
    `Y.Doc` (TC-37 deletes a note through the model mid-interaction).
12. **`StickyNote` is exported as `memo(...)`** (same props as the contract) so that 500 notes
    do not all re-render on every drag frame; `useBoardDoc` keeps unchanged note snapshots
    identical between updates.
13. **Component tests fake only animation frames** when using `userEvent` (Testing Library's
    async wrapper needs a real `setTimeout`).
14. **Browsers.** WebKit launched on the build machine for this run, so e2e ran in chromium,
    firefox and webkit (the default).

### Not covered
- The 500-note performance run is manual (design "Not covered"); the fixture builder is
  `tests/fixtures/board500.ts` but there is no in-app way to load it yet, and the run was not done.
- IME composition is covered by a jsdom test of the composition events only; a real macOS
  Japanese IME check was not possible on this machine.

## Story 3 — See other people's edits appear live on the same board

Decisions taken where the spec was silent or ambiguous:

1. **Vitest downgraded 5 → 4.1.** `@cloudflare/vitest-pool-workers` (0.22, the design's
   integration runner) requires vitest ^4.1 and fails to start its pool under vitest 5. All
   existing unit/component tests pass unchanged on vitest 4.1.
2. **Compatibility date 2026-08-15** (was 2026-09-01): the workerd binary bundled with the pool
   supports dates up to 2026-08-22 only.
3. **`binaryType = 'arraybuffer'`** is set on the room's server sockets (and the integration
   client's): at this compatibility date workerd delivers binary frames as `Blob` by default.
4. **`assets.run_worker_first: ["/api/*"]`** in `wrangler.jsonc`, otherwise the
   single-page-application fallback would answer room upgrades with `index.html`.
5. **Two TypeScript projects.** `tsconfig.worker.json` (Workers runtime types, no DOM) covers
   `src/worker`, `src/shared` and `tests/integration`; `npm run typecheck` runs both.
6. **`npm run test:integration` builds the client first** (`vite build`) because TC-06 checks
   that `/b/<id>` is served `index.html` from `dist/client`.
7. **Routing.** `main.tsx` calls `resolveBoardRoute()` (in `App.tsx`): a valid `/b/:boardId` is
   used as is; any other address, including `/` and `/b/<invalid id>`, is replaced with
   `/b/<newBoardId()>` via `history.replaceState`. Temporary until story 5.
8. **`App` props.** `App` takes `boardId`, and optionally `doc` and `createProvider` (a
   provider factory, so component tests can inject a fake y-websocket provider). Without
   `boardId` the board is local-only and the badge stays hidden (existing component tests).
   `useBoardDoc` takes an options object `{ boardId, doc, createProvider }` and also returns
   the mapped `connection` state.
9. **State mapping details.** The provider's `connected` status only counts once `sync(true)`
   follows. A first attempt that fails before ever syncing stays "Connecting…". A drop during
   the green confirmation cancels its timer and shows "Reconnecting…" at once.
10. **Deleted-note handling** needed no change: story 2 already clears selection/editing for
    a note that disappears, and a note's drag ends when its component unmounts (TC-25).
11. **Test hook.** In test builds `window.__vidi6.connectionState` and `connectionLog` expose
    the mapped state (nightly TC-29/TC-30). They are not in the production bundle.
12. **Outage simulation (TC-27).** Chromium's `context.setOffline(true)` blocks new requests
    but does not cut an already open WebSocket. The e2e helper therefore also proxies board
    sockets with `context.routeWebSocket`: going offline drops them and refuses reconnections
    until the network is back. The server path is still the real one (`connectToServer`).
13. **Nightly specs** are `tests/e2e/**/*.nightly.spec.ts`, run with `npm run test:e2e:nightly`
    and excluded from `npm run test:e2e`. Last local TC-30 run: 3,132 deliveries, p50 29 ms,
    p95 65 ms, max 139 ms.
14. **Multi-context e2e cases beyond TC-22/TC-23 skip in Firefox/WebKit** (design: Chromium is
    sufficient). On this run Firefox and WebKit were not installed, so e2e ran with
    `E2E_BROWSERS=chromium`.
15. **`vite dev` proxy.** `npm run dev` forwards `/api` (including WebSockets) to a
    `wrangler dev` on port 8787, so live sync also works in the Vite dev server.
16. **Every tab calls `initDoc`** before syncing. Concurrent sets of the same schema version
    converge, so this is harmless.

### Not covered
- Real-internet latency and a true production Durable Object restart (design "Not covered");
  TC-18 simulates the restart with a fresh object instance.
