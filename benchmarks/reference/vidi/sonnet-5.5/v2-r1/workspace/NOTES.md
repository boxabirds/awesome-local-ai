# Notes — story 1

- `BoardViewport` owns `useCamera` and also renders `NavigationHint` and `ZoomControls` (the design wires them in `App.tsx`). The viewport size is measured inside `BoardViewport`, and the controls need the same camera, so this avoids a context for one story. `App.tsx` just mounts `BoardViewport`.
- `useCamera` additionally exposes `zoomBy`, `setCamera` and `getCamera` (used for Safari gestures and the test-only `window.__vidi6` hook).
- Initial camera is `resetCamera(window size)`, so the origin starts centred in the board area.
- Keyboard shortcuts (Ctrl/Cmd + `=`, `-`, `0`) are listened for on `window` regardless of focus; no other focusable page content exists yet.
- `test:e2e` builds in `--mode test` (enables `window.__vidi6`) then runs Playwright against `wrangler dev`. `npm run build` is a production build with no hook. Only Chromium is installed here, so Firefox/WebKit projects are configured but were not run.
- At 1,000,000 units the origin marker is off screen, so TC-27 measures the grid (background position) and camera deltas rather than the marker.
- Red-phase commit for task 1 was skipped; tests and implementation are in one commit.

# Notes — story 2

- `createSticky` returns `string | false` (false on non-finite coordinates or unknown colour) so rejection is visible to callers; the design contract says `string` but TC-39 requires a rejection value.
- The model's `createSticky(at)` subtracts `STICKY_SIZE_WORLD / 2` itself, so `BoardViewport` and the toolbar pass the world point to centre on.
- `BoardViewport` accepts `children` as a render function and an `overlay` render prop (screen-space toolbars) plus `onCreateAt` / `onEmptyClick`, because it owns the camera; `App.tsx` wires doc, selection and toolbars through these.
- Notes are rendered in stable id order and stacked with `z-index`. Re-ordering DOM nodes by z on `bringToFront` dropped pointer capture mid-drag in Chromium (found by the e2e test).
- `StickyNote` has an optional `onDragChange` prop so `App` can hide the note toolbar while dragging. Selection happens when the drag starts or on pointer-up.
- `StickyTextEditor` is a textarea overlaid on the (hidden) display text, which stays rendered so font fit follows the live text. Remote Y.Text changes are mirrored into the textarea.
- Component tests use a `Harness` (tests/component/helpers.tsx) around `StickyNote` for model-level access, and `App` for end-to-end wiring.
- Only Chromium was run for e2e. Red-phase commits for the test-first tasks were skipped; tests and implementation are committed together.

# Notes — story 3

- `@cloudflare/vitest-pool-workers` peers on `vitest ^4.1`, so vitest was moved from 5.0.3 to ^4.1.0 (existing unit/component tests pass unchanged).
- Worker code is type-checked by `tsconfig.worker.json` (workers runtime types in the generated `worker-configuration.d.ts`, no DOM lib); `npm run typecheck` runs both configs. Regenerate with `npm run types:worker`.
- `useBoardDoc(boardId?)` only connects when given a board id, so the component tests that render `<App />` stay local. `main.tsx` reads `/b/:boardId` and replaces `/` with a fresh `/b/<newBoardId()>` (story 5 replaces that).
- `connectBoard` takes an optional fourth argument (provider factory) so TC-19 to TC-21 can drive the status mapping with a fake provider.
- y-protocols `readSyncMessage` only logs bad updates, so `BoardRoom` decodes the sync sub-type itself and applies updates with `Y.applyUpdate`; that is what lets an invalid update close the socket with 1003 (TC-15).
- Remote text changes used to reset the caret to the end of the open editor (found by TC-23: concurrent typing interleaved). `StickyTextEditor` now maps the caret through the remote Y.Text delta (`mapCaretThroughDelta`).
- Selecting/editing is not in the doc. A note deleted remotely clears selection/editing/drag state in `App`.
- Playwright `context.setOffline` does not close an already-open WebSocket, so TC-27 proxies the board socket with `page.routeWebSocket` (`controlNetwork`) and closes it / refuses reconnects while offline.
- The zoom label is an `<output>` (implicit role `status`), so e2e finds the badge by role and text.
- `window.__vidi6.connectionState` (test builds only) exposes the mapped state for TC-29.
- Nightly specs live in `tests/e2e/nightly` and run with `npm run test:e2e:nightly`; the default `test:e2e` excludes them. `test:integration` builds the client first because TC-06 needs the assets.
- Only Chromium was run for e2e. Red-phase commit for task 1 was skipped.

# Notes — story 4

- `nextRoomState(state, event)` (`src/worker/room-state.ts`) takes event objects; `connect` carries `sinceFailureMs` and `retryAfterMs`. `BoardRoom` uses it for its lifecycle and for the load-retry decision. A failed save leaves the room without a doc (state `loading`); the next connection reloads from storage.
- `BoardStore.compactIfNeeded(doc, force = false)` has an extra `force` flag, used by the test hooks and tests to compact below the thresholds.
- `BoardRoom` exposes `store`, `state` and `reload()` (re-reads storage, dropping the in-memory doc). Tests use them to simulate reconstruction after hibernation and to inject failures. `testCorruptSnapshot` / `testRepairSnapshot` are RPC methods that throw unless `env.TEST_HOOKS === '1'`.
- Test hooks: `POST /__test/boards/:id/corrupt-snapshot|repair`, registered in `src/worker/test-hooks.ts` only when `env.TEST_HOOKS === '1'`. `wrangler.jsonc` runs the worker first for `/__test/*` so the check happens in code; without the var the request falls through to the SPA assets. The e2e wrangler servers pass `--var TEST_HOOKS:1`; production config never sets it.
- Corrupting a snapshot truncates chunk 0 by 10 bytes (the design's "truncated update" fixture); repair restores the saved chunk.
- `npm run test:e2e` runs the shared-server specs, then `playwright.persistence.config.ts`, which has no webServer. `persistence.spec.ts` starts and SIGKILLs its own `wrangler dev --persist-to <tmp>` on port 8788 (`tests/e2e/helpers/wrangler-process.ts`).
- Big-board and broken-board e2e specs seed boards from Node with `y-websocket` over the global `WebSocket`, then confirm a second connection sees everything (so it is stored) before restarting or corrupting. The 2,000-note board rendered in about 0.6 s locally (budget logged, not asserted).
- Client: `connectBoard` maps close code 4500 to `load_failed`; any other close, including 1011 and 1003, maps to `reconnecting` once synced. `ProviderLike` gains the `connection-close` event, and the component FakeProvider was updated to match. `canEdit` is exported from `App.tsx`. While `load_failed`: the Sticky note button is disabled, create, delete, Enter-to-edit and the note toolbar are off, and notes ignore drag and double-click-to-edit (`StickyNote` `readOnly`).
- The per-row SQLite limit of Durable Objects was not re-checked online (no network use in this build). 512 KiB chunks are far below the documented 2 MB limit.
- Only Chromium was run for e2e. Red-phase commit for task 1 was skipped.

# Notes — story 5

- `App.tsx` still exports the board UI (`App`, used by component tests and `BoardPage`); the router lives in the new `src/client/Root.tsx`, which `main.tsx` renders. The story 3 redirect from `/` is gone.
- `nextBoardPageState` takes an optional fourth `boardId` argument so the `ready` state can carry the id (the design signature has no id). `retryDelayMs(attempt)` in `pages/state.ts` is the capped exponential backoff.
- The New board button with its Creating…/failure handling is `pages/NewBoardButton.tsx`, shared by `HomePage` and `NotFoundPage` (the design says the not-found page reuses the create action).
- `compatibility_date` (2025-09-01) already supports Durable Object RPC, so `wrangler.jsonc` is unchanged.
- Integration `WsClient.connect` initialises the board first (boards must exist now); pass `create = false` to connect without it. E2E helpers create boards through `POST /api/boards` (`createBoardId`), and `openBoard` clicks New board on the home page.
- Legacy-board e2e (TC-31) uses a test-hook route `POST /__test/boards/:id/seed-legacy` (body = one Yjs update) that stores the update with no `created_at`; it exists only with `TEST_HOOKS=1`.
- `BoardStore.load()` returns an empty board when the tables are missing; `append()` migrates lazily; `migrate()` no longer runs on room construction. `initialize()` on the store backs the room RPC.
- Only Chromium was run for e2e. Red-phase commits were skipped.
