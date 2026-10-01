# Notes

## Story 1 decisions
- `BoardViewport` takes an extra optional `overlay(api)` render prop (siblings of the viewport) so `App` can wire
  `ZoomControls` and `NavigationHint` to the same `useCamera` instance the viewport uses. Controls are not
  DOM descendants of the viewport, so Ctrl-wheel over them never reaches the board.
- `useCamera` also returns `zoomByFactor`, `setCamera`, `getCamera`, `panning` (extras beyond the contract,
  used by gestures, the test hook and cursor/state rendering).
- Initial camera is `resetCamera(window size)`, i.e. the starting point is centred on load.
- Dots are drawn at tile centres of a radial-gradient background, offset by half a tile so they sit on world multiples of `GRID_SPACING_WORLD`.
- Window keydown shortcuts are handled whenever the page is open (no other focusable inputs exist yet).
- `test:e2e` builds with `--mode test` (installs `window.__vidi6`) and then runs Playwright against `wrangler dev`
  on port 8791. The production `npm run build` contains no test hook.
- Only Chromium is installed in this environment; e2e was run in Chromium only (config also lists Firefox and WebKit).
- Component tests polyfill `PointerEvent` for jsdom.

## Story 2 decisions
- `createSticky` returns `string | false` (false on non-finite coordinates, per TC-39) rather than plain `string`.
- `NoteToolbar` is rendered inside `StickyNote` (counter-scaled by 1/zoom so it keeps screen size) so the note can hide it while dragging/editing.
- Stacking uses CSS `z-index` = `z`; DOM order is by id and stays stable. Reordering DOM nodes on `bringToFront` dropped pointer capture mid-drag.
- `BoardViewport` accepts `children` as a render function and passes `size` to `overlay`/children (`BoardApi`), plus `onDoubleClickEmpty` and `onEmptyClick`.
- While editing, the textarea is top-aligned (display text is vertically centred).
- A selected note's toolbar can be covered by a higher-z overlapping note.
- Delete/Backspace work when a toolbar button has focus; Enter does not (it activates the button).
- E2E ran in Chromium only (Firefox/WebKit not installed). `test:e2e` builds in test mode, so run `npm run build` afterwards for the production bundle.

## Story 3 decisions
- `@cloudflare/vitest-pool-workers` 0.12.x is used because newer versions need vitest 4; the repo is on vitest 3.2. Vitest 3.2 cannot resolve the pool by bare name, so `vitest.integration.config.ts` passes the resolved path as `pool` and sets `isolatedStorage: false` (open Durable Object sockets break per-test storage isolation). The root `vitest.config.ts` lists it as a project; `npm run test:integration` builds first because the Worker serves `dist/client`.
- Typechecking is split: `tsconfig.json` (browser) excludes `src/worker` and `tests/integration`; `tsconfig.worker.json` (workers-types) covers them. `npm run typecheck` and `build` run both.
- `/` and any non-`/b/<valid id>` path are redirected with `history.replaceState` to `/b/<newBoardId()>` (no reload, so e2e helpers do not race a navigation). Story 5 replaces this.
- `wrangler.jsonc` uses `run_worker_first: true` so the Worker sees every request and forwards non-room paths to `ASSETS` (needed for TC-06 under `SELF.fetch`).
- y-protocols `applyUpdate` swallows undecodable updates (logs, ignores), so BoardRoom validates update payloads with `Y.decodeUpdate` before applying, to close with 1003 as designed (TC-15).
- `connectBoard` takes an optional 4th `factory` argument (fake provider in component tests). `window.__vidi6.connectionState` is set from `App` in test builds (TC-29).
- `StickyTextEditor` now mirrors remote Y.Text changes into the textarea, shifting the caret through the delta; story 2 only wrote local edits.
- Component tests get `tests/component/setup.ts`: a never-opening `WebSocket` stub and a `/b/<id>` location.
- The ConnectionStatus badge is found in e2e by text, because the zoom `<output>` also has role=status.
- E2E TC-27 really waits the 30 s outage (CATCH_UP_TEST_OUTAGE_MS); Playwright `setOffline` did drop the socket and the badge showed Reconnecting. Latencies are logged (`[latency]`), never asserted. Nightly TC-29/TC-30 are tagged `@nightly` and run with `npm run test:e2e:nightly`. Chromium only here.

## Story 4 decisions
- `BoardStore` takes a structural `StorageLike` (sql.exec + transactionSync) instead of `DurableObjectStorage`, so the module also typechecks in the browser tsconfig (unit tests import it) and tests can inject failing wrappers. `compactIfNeeded(doc, force = false)` has an extra `force` flag, used by the test hook and tests.
- `nextRoomState` models the full lifecycle (loading/ready/compacting/load-failed/storage-failed/hibernated); `BoardRoom` drives its edges through it, but compaction is synchronous and hibernation is platform-controlled, so those edges are only exercised in the unit test.
- `BoardRoom` exposes `store`, `doc`, `state`, `loadFailedAt` and `resetRoom()` publicly so integration tests can inject failures and age the retry timer. Integration tests simulate a restart/wake by constructing a second `BoardRoom` over the same `DurableObjectState`.
- Test hooks (`/__test/boards/:id/corrupt-snapshot` and `/repair`) are routed by the Worker only when `env.TEST_HOOKS === '1'`; the room-side RPC `testHook` also refuses otherwise. `TEST_HOOKS` is set only by `--var TEST_HOOKS:1` on the e2e `wrangler dev` commands, never in `wrangler.jsonc`. "Corrupt" force-compacts first (so a snapshot exists), truncates chunk 0 by 10 bytes, and resets the room so the next connection reloads.
- Persistence e2e (`tests/e2e/persistence.spec.ts`) needs its own `wrangler dev --persist-to` process, so it runs under `playwright.persistence.config.ts` (port 8792, Chromium); the main config ignores it. `npm run test:e2e` runs both. `@types/node` was added for the process helper.
- `connectBoard` maps provider `connection-close` code 4500 to `load_failed`; any other close code means `reconnecting`. While `load_failed`, `status: disconnected` does not change the state; the next successful sync goes straight to `connected` (no green "Connected"). y-websocket retries quickly when the server closes an opened socket, so the server throttles real reload attempts to `LOAD_RETRY_MIN_INTERVAL_MS`.
- Edit lock: `canEdit` is exported from `App.tsx`; `StickyNote` has a `readOnly` prop (no drag, text edit, colour or delete) and the Sticky note button is `disabled`.
- A client update is stored as one row and not split, so a single update above the platform per-row limit (2 MB) would fail to store (the client would show "Reconnecting…"). Snapshots are chunked.
- Large boards: opening 2,000 notes took ~7 s in Chromium, all in client rendering (each note's text fit forces reflows). `contain: size layout style` on `.sticky-text-box` brought it to ~1 s (logged by TC-21, not asserted).
- With default Playwright parallelism the story 3 test TC-26 (full-capacity session) fails on this machine with or without this story (verified on the previous commit); it passes with `--workers=2`. Chromium only; Firefox/WebKit are not installed.
