# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was open or self-contradictory:

- **Wiring BoardViewport to the camera.** The design gives `BoardViewport(props: { children })` but also has
  `App.tsx` wire `useCamera` to `ZoomControls`, and the viewport measures its own size. To keep that
  exact props contract, `App` calls `useCamera` and provides it (plus `setViewportSize`) through
  `BoardCameraContext` (`src/client/canvas/useCamera.ts`); `BoardViewport` reads it with `useBoardCamera()`.
- **Extra hook method.** `useCamera` also exposes `zoomAtPoint(p, factor)` for Safari `gesturechange`
  (scale ratio), which the listed hook methods had no way to express.
- **Initial view.** The camera starts as `resetCamera(window size)`: 100% with the board's starting
  point (marked by a small crosshair) at the centre, i.e. the same view Reset view returns to.
- **Named constants.** Added `WHEEL_LINE_HEIGHT_PX` (line-mode wheel deltas) to `src/shared/config.ts`;
  `PERCENT` and `ZOOM_STEP_SNAP_EPSILON` live in `camera.ts`. Page-mode wheel deltas use the board height.
- **Keyboard shortcuts** (Ctrl/Cmd + `=`/`+`, `-`, `0`, incl. numpad) are handled on `window` for the whole
  page (the page is the board), except while typing in an editable field.
- **Drag buttons.** Primary and middle mouse buttons both pan.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'` (Vitest, and `npm run build:test` used by Playwright); production
  builds contain no trace of it. `setCamera` does not dismiss the navigation hint.
- **Red phase.** Task 1's failing-test phase was run locally against a throwing stub (22/22 failed with
  "not implemented"), but not committed separately: the session's instructions ask for a single story commit.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects, but skips
  Firefox/WebKit when their browser binaries are not installed. Only Chromium is installed on this
  machine, so e2e was verified in Chromium only.
- `npm run test:e2e` builds in test mode and serves `dist/client` with `wrangler dev` on port 8787.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **`createSticky` return type.** The contract says it returns `string`, but TC-39 requires non-finite
  coordinates to be rejected with `false`; it is typed `string | false` (also `false` for an unknown colour).
  `at` is the note's **centre**; the model subtracts `STICKY_SIZE_WORLD / 2` (as tasks.md states).
- **No-op mutations return `false`** without a transaction: `moveObject` to the same position,
  `setStickyColor` to the current colour, `bringToFront` on a note already strictly on top (a note tied
  for the top z is still lifted, so the stacking is unambiguous).
- **Stacking without re-ordering the DOM.** Notes render in stable id order with `z-index: z`, which
  equals the `(z, id)` sort of `snapshot()`. Re-ordering DOM nodes on `bringToFront` would detach the
  dragged element and lose pointer capture mid-drag.
- **Note toolbar placement.** Because each note is its own stacking context, the floating `NoteToolbar`
  is rendered by `App` in a screen-space layer above the board (positioned with `worldToScreen`), not
  inside `StickyNote`; so it never scales with zoom and is never covered by other notes. `StickyNote`
  got an extra optional prop `onDragChange(dragging)` so the toolbar hides while dragging.
- **`BoardViewport`** got optional props `onEmptyDoubleClick(worldPoint)` and `onEmptyClick()` (a press
  and release on empty space moving less than `DRAG_THRESHOLD_PX`; panning keeps the selection).
- **Text limit when typing in the middle.** `clampToLimit` keeps the first 1,000 characters (contract).
  The editor additionally uses `clampEdit(prev, next)`, which drops the part of the *inserted* text that
  does not fit, so typing in the middle of a full note adds nothing instead of pushing the last character
  out. Lengths are UTF-16 code units; cuts never split a surrogate pair.
- **Text fit.** `fitFontSize` measures the display text element (always rendered, hidden while editing)
  against the inner text box (`STICKY_SIZE_WORLD − 2 × 16` padding); padding and line height are
  constants in `StickyText.ts` shared by the display element and the textarea. The editor textarea is
  vertically offset to match the centred display text.
- **Keyboard.** `App` handles Enter/Delete/Backspace on `window` for the selected note only when not
  editing, focus is not in an editable field, and no Ctrl/Cmd/Alt modifier is held; Enter on a focused
  button is left to the button. A note focused with Tab (`:focus-visible`) becomes selected, and Enter on
  a focused note edits it. Escape returns focus to the note.
- **Test support.** `App` accepts an optional `doc` prop (component tests pass a real `Y.Doc`), and the
  test-mode-only `window.__vidi6` hook gained `getNotes()` for e2e assertions (`installTestHooks` now
  merges hooks). Production builds still contain no trace of it.
- **Red phase.** As in story 1, test-first phases were not committed separately (single story commit).
- **Not verified manually:** IME (e.g. Japanese) input; the editor skips `input` during composition and
  commits on `compositionend`. E2E ran in Chromium only (Firefox/WebKit not installed).

## Story 3 — See other people's edits appear live on the same board

- **Vitest 4.1 instead of 5.** `@cloudflare/vitest-pool-workers` (0.22, the latest) only supports
  `vitest ^4.1` and fails to start under vitest 5, so the repo is on `vitest@^4.1.11` (unit and component
  suites are unchanged and pass). Revisit when the pool supports vitest 5.
- **Compatibility date 2026-08-22.** The workerd bundled with the Workers test pool rejects newer dates
  than 2026-08-22, so `wrangler.jsonc` uses that date (was 2026-09-01; nothing in the app depends on it).
- **`binaryType = 'arraybuffer'`.** With current compatibility dates workerd delivers binary WebSocket
  frames as `Blob` by default; the room (and the integration test client) set `arraybuffer`.
- **`assets.run_worker_first: ["/api/*"]`** so room connections always reach the Worker and never the
  SPA fallback. Any `/api/rooms/<anything>` that is not a valid id gets 400 (including nested paths).
- **Two tsconfigs.** `tsconfig.worker.json` type-checks `src/worker`, `src/shared` and
  `tests/integration` against `@cloudflare/workers-types` (no DOM); `npm run typecheck` runs both.
  `test:integration` runs `vite build` first because the assets binding needs `dist/client`.
- **Routing.** `main.tsx` resolves the board from `/b/:boardId` via `boardIdFromLocation()` (in `App.tsx`)
  and passes it to `<App boardId>`; `/` and any address that is not a valid `/b/<id>` are replaced
  (`history.replaceState`) with `/b/<newBoardId()>` until story 5. `App` without `boardId` (component
  tests) keeps a local, unconnected doc and shows no badge. `useBoardDoc(boardId, doc?)` now also
  returns the `connection` state.
- **Status mapping** lives in `trackConnectionState(providerEvents, onState)` (exported from
  `connectBoard.ts`) so component tests drive it with a fake emitter. The first sync after
  `connecting` → `connected` (no green badge on first load); failed first attempts stay "Connecting…".
- **Browser offline/online events.** `connectBoard` also drops the socket on `window` `offline` and
  reconnects immediately on `online`, so the amber badge appears at once instead of after y-websocket's
  30 s silence timeout, and recovery does not wait for the backoff.
- **Remote typing while editing.** Story 2's editor only read the Y.Text when editing started and wrote
  textarea-vs-Y.Text diffs, which would have erased someone else's simultaneous typing. The editor now
  observes non-local Y.Text changes, updates the textarea immediately and maps the caret/selection
  through the change (a remote insert exactly at the caret goes after it). Limitation: a remote change
  arriving mid-IME-composition updates the textarea and may cancel the composition (not verified).
  Concurrent typing can push a note past `STICKY_TEXT_MAX_CHARS`; the limit is only enforced per local edit.
- **Delete during edit/drag** relies on story 2's behaviour: `App` clears a selection whose note is gone
  (which also ends editing), and `StickyNote` unmounting ends a drag; no extra `useSelection` change.
- **Test hooks.** `window.__vidi6.connectionState` and `connectionStates` (history) are installed in
  test builds only. The e2e `zoomLabel` helper is now scoped to `.zoom-controls` (the badge is also a
  `role=status`), and `openBoard` waits for `connectionState === 'connected'`.
- **E2E.** `tests/e2e/live-collaboration.spec.ts` (TC-22–TC-28) runs in `npm run test:e2e`;
  `tests/e2e/live-collaboration.nightly.spec.ts` (TC-29, TC-30) runs only via `npm run test:e2e:nightly`
  (a `nightly` Playwright project that exists only when `VIDI6_NIGHTLY=1`). Latency is logged against
  `LIVE_UPDATE_LATENCY_BUDGET_MS`, never asserted. In TC-30, per-change latency is measured for creates
  and typed text (unique tokens, matched as an in-order subsequence because others may type into the same
  note); moves and recolours are only checked through final convergence. TC-29 checks "no reconnect"
  by counting WebSocket constructions in the page; destroy-on-unmount is covered by a component test,
  because nothing is observable in a page after its context is closed.
- **TC-18 restart** is simulated with a fresh board id (a fresh room instance), per the design.
- E2E ran in Chromium only (Firefox/WebKit not installed).
- **TC-30 driving details.** The soak creates notes with a synthetic `dblclick` on the empty board and edits
  with focus + Enter (story 2's keyboard path). With real double-clicks, the first click could select a
  note that someone else is dragging, and that note's toolbar (which follows it) could catch the second
  click on "Delete note". That is a real but harmless user-level race, not a sync fault. Text that cannot
  land because a busy note hit `STICKY_TEXT_MAX_CHARS` is not tracked as a delivery.
- **Stale e2e server.** `playwright.config.ts` keeps story 1's `reuseExistingServer` outside CI. A
  leftover `wrangler dev` on port 8787 serves whatever is in `dist/client`. If `npm run build`
  (production, no test hooks) ran last, every e2e test times out. Stop the old server first.
