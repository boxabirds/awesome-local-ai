# Notes

## Story 1 decisions

- `BoardViewport` takes a `controller` (the `useCamera` result) and an `onResize` prop in addition to `children`, so `App.tsx` can share the camera with `ZoomControls` and `NavigationHint`. The design's contract lists only `children`, but it also says controls are wired to `useCamera` in `App.tsx`.
- `useCamera` keeps the latest camera in a ref, so several events in one frame compose, and flushes React state once per `requestAnimationFrame`. The UI therefore lags an event by up to one frame, and the e2e tests poll for that.
- Initial camera is `resetCamera(window size)`, so the origin starts centred. The viewport size is then tracked by a `ResizeObserver`; resizing never changes camera x/y.
- `useCamera` also exposes `zoomAtPoint` (Safari pinch) and `setCamera` (test hook only).
- Keyboard shortcuts (Ctrl/Cmd + `=`/`+`/`-`/`0`) are bound on `window`; the app has no other focusable inputs yet, so "board focused" is treated as always.
- The dot grid is a CSS radial-gradient with the dot at the tile centre; the background offset is computed modulo the world spacing, so it stays exact at 1,000,000 units.
- `test:e2e` builds with `--mode test` (which enables `window.__vidi6`) and then runs Playwright against `wrangler dev`. `npm run build` produces the production bundle without the hook.
- Only Chromium is installed in this environment, so the Firefox and WebKit e2e projects are configured but were not run. WebKit/Firefox pixel behaviour is unverified here.
- Hint, ZoomControls and wheel-over-controls tests (TC-22, TC-30, TC-32 and others) run in jsdom.
- TC-07 is trivial because the camera module has no viewport-size input. The design's contract has no resize function, so the test just asserts an existing camera object is not touched.
- The red-phase commit for task 1 was skipped; tests and implementation were committed together in one commit.

## Story 2 decisions

- `createSticky` takes the note **centre** and subtracts half the size itself (as the board-model contract says); callers pass the click or viewport-centre world point. Non-finite points return `""`.
- `App` accepts an optional `doc` prop (tests seed a real `Y.Doc`); `useBoardDoc` adopts it.
- Notes render in a stable DOM order (createdAt, id) and stack with `z-index` from the `(z, id)` order. Re-ordering DOM nodes during `bringToFront` dropped pointer capture mid-drag. `StickyNote` has an extra optional `stackIndex` prop for this.
- `StickyNote` renders its own `NoteToolbar` (scaled by 1/zoom so it keeps screen size). A removed note clears the selection via an effect in `App`.
- A note also becomes selected when it receives keyboard focus (Tab). Editing a note keeps a hidden measuring copy of the text, so font fit and vertical centring work in edit mode.
- `StickyTextEditor` takes an extra optional `padTop` prop to keep typed text vertically centred like displayed text.
- Empty-board click is detected on pointerup (< `DRAG_THRESHOLD_PX` movement) in `BoardViewport`, via new `onBoardClick` / `onBoardDoubleClick` props.
- The story 1 navigation hint is unchanged: it hides only after the user navigates, not when notes exist.
- Only Chromium e2e was run; Firefox/WebKit are not installed here.

## Story 3 decisions

- `@cloudflare/vitest-pool-workers` (0.22) requires Vitest 4, so Vitest was moved from 5 to `^4.1` for the whole repo. The pool uses the `cloudflareTest` plugin in a third `integration` project (`npm run test:integration`).
- `npm run typecheck` runs two programs: the root `tsconfig.json` (DOM client, tests) and `tests/integration/tsconfig.json` (workerd types for `src/worker`, `src/shared`, integration tests). They cannot share one program because the workers types conflict with the DOM lib.
- `wrangler.jsonc` sets `assets.run_worker_first: ["/api/*"]` so the SPA fallback never swallows WebSocket upgrades; everything else is served by assets directly.
- y-protocols' `readSyncMessage` swallows `applyUpdate` errors, so `BoardRoom` decodes sync messages itself (`readSyncStep1` / `Y.applyUpdate`) to close with 1003 on an invalid update, as the design requires.
- `App` serves `/b/:boardId`; any other path (including `/`) redirects to `/b/<newBoardId()>`. When a `doc` prop is passed (component tests), `App` stays local with no provider. The component test setup stubs `y-websocket` and sets a `/b/<id>` URL.
- `connectBoard` takes an optional 4th argument (a provider factory) so component tests can drive status and sync events with a fake provider.
- Test builds expose `window.__vidi6.connectionState` for the nightly idle test.
- The connection badge is a `div role="status"`; the story 1 zoom readout is also an `<output>` (implicit `status` role), so e2e tests select the badge with `div[role=status]`.
- TC-27: Chromium's `setOffline` does not close an open WebSocket; the y-websocket no-message watchdog (about 30 s) notices, so the test waits up to 60 s for "Reconnecting…".
- Story 2's component test "TC-20 a 3px move" picked `notes()[0]`, which is not stable (DOM order is createdAt then random id); it now looks the note up by id.
- Nightly e2e (`npm run test:e2e:nightly`, tests tagged `@nightly`, chromium only) is excluded from `test:e2e`. The TC-30 soak uses simple UI actions (create, type, small drags) for 60 s; latency is logged, never asserted. Delete and recolour are covered by the seeded integration test TC-12 rather than the UI soak. The teardown check only asserts no new WebSocket opens after the contexts close.
- Only Chromium was run (Firefox/WebKit not installed).

## Story 4 decisions

- `chunkBytes`, `joinChunks` and `shouldCompact` live in `src/worker/chunking.ts` and are re-exported from `board-store.ts`. The root (DOM) TypeScript program cannot see Workers types, so unit tests import the pure helpers from `chunking.ts`.
- `BoardRoom` tracks its own `state` (`ready | load-failed | storage-failed`) rather than calling `nextRoomState`. `room-state.ts` holds the pure lifecycle function from the design and is unit-tested (TC-27), but it is not wired into the class.
- `BoardRoom` exposes `store`, `doc`, `state`, `load()` and `ready` so integration tests can inject failures and reconstruct instances. TC-18 simulates a wake by constructing a second `BoardRoom` over the same `DurableObjectState`.
- Test hooks (`src/worker/test-hooks.ts`) are only reachable when `env.TEST_HOOKS === '1'`. The Playwright web server and the persistence helper pass `--var TEST_HOOKS:1`; `wrangler.jsonc` does not set it. `run_worker_first` also lists `/__test/*` so the hooks are not swallowed by assets; without the var those paths fall through to the SPA (covered in `worker.test.ts`).
- Corrupt hook: forces a compaction, saves chunk 0 in the object's KV store, overwrites it, then reloads the room (it becomes `load-failed`). Repair restores chunk 0; the next connection after `LOAD_RETRY_MIN_INTERVAL_MS` reloads.
- `persistence.spec.ts` is its own Playwright project (`persistence`, port 8790, own `--persist-to` temp dir). The shared `webServer` still starts but is unused by it; the other projects ignore this spec. Large boards are seeded over a real WebSocket (`helpers/seed.ts`), not through the UI.
- Client: `connectBoard` also handles `connection-close`. Code 4500 sets `load_failed`; any other code after a successful connection (1011, 1003, network) sets `reconnecting`. The first sync after `load_failed` goes straight to `connected`. `StickyNote` gets an `editable` prop and `Toolbar` a `disabled` prop; `App` exports `canEdit`.
- Large-board load: 2,000 notes took about 11 s on the client because each note's text-fit measurement forced a whole-board layout. Giving each fixed-size note `contain: size layout style` brought it to about 1.5 s, so no virtualisation was needed.
- TC-19 creates 25 notes through the UI (with a drag and recolouring) and compares ids, positions, colours, text and z-index order before and after a real process kill and restart.
- Only Chromium was run (Firefox/WebKit not installed).
