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
