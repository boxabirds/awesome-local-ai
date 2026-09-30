# Implementation notes

## Story 1 — Pan and zoom around an infinite board

Decisions made where the spec was silent or ambiguous:

- **Camera wiring.** The design gives `BoardViewport` only a `children` prop, yet `App.tsx`
  must also feed `ZoomControls` and `NavigationHint` from `useCamera`. `App` owns
  `useCamera` and passes it to `BoardViewport` through `CameraContext`
  (`src/client/canvas/useCamera.ts`), along with a callback for the ResizeObserver size.
- **Extra `useCamera` members.** Besides the contract, the hook exposes `zoomAt(point, factor)`
  (used for Safari `gesturechange` scale ratios) and `setCamera(cam)` (used only by the
  test hook).
- **Initial view** is the same as Reset view: 100%, with the board origin centred. Pressing
  Reset view when already there is a no-op and does not dismiss the hint.
- **Grid level of detail.** At low zoom a 24-unit grid would be 2.4 px apart and read as a grey
  haze. The spacing doubles (48, 96, …) until dots are at least `GRID_MIN_SCREEN_SPACING_PX`
  (8 px) apart. Dots are always a subset of the base grid, so they stay attached to the board.
  At zoom ≥ 1/3 the spacing is exactly `GRID_SPACING_WORLD * zoom`.
- **Additional named settings** in `src/shared/config.ts`: `ZOOM_STEP_SNAP_EPSILON`, `PERCENT`,
  `WHEEL_LINE_HEIGHT_PX`, `GRID_MIN_SCREEN_SPACING_PX`.
- **Keyboard shortcuts** listen on `window`, which in this story means "while the board is
  focused" because the whole page is the board. They are ignored when focus is in an editable
  element (for later stories' text inputs). `+`/`_` and numpad keys are accepted as
  aliases for `=`/`-`.
- **Test hook.** `window.__vidi6` (`setCamera`, `getCamera`) is installed only when
  `import.meta.env.MODE === 'test'`. `npm run build:test` builds that mode for e2e; the
  production `npm run build` does not contain it (checked via grep).
- **Camera readout for tests.** The viewport element carries `data-camera-x/y/zoom` and
  `data-state="idle|panning"` attributes so component and e2e tests can assert state.
- **E2E browsers.** `playwright.config.ts` defines chromium, firefox and webkit projects but
  only enables the ones installed locally. In this environment only Chromium is installed, so
  e2e ran in Chromium only.
- **Commits.** The whole story went into a single commit (per the session instructions)
  instead of a separate red-phase commit for task 1.
- **Not covered by automated tests:** Safari pinch in a real browser, trackpad hardware
  differences, and touch input. These match the design's "Not covered" list. The manual
  Chrome/Safari check in task 3 was replaced by automated Chromium e2e plus a visual screenshot check.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **Stable DOM order, z-index stacking.** Notes are rendered in id order with `z-index` taken
  from the `(z, id)` snapshot order. Re-ordering DOM nodes on `bringToFront` would move the
  element that holds the drag's pointer capture, which browsers treat as losing capture.
- **Note toolbar placement.** `NoteToolbar` is rendered by `App` in the world layer *after* all
  notes (an anchor at the note's top-centre with `scale(1 / zoom)`), not inside `StickyNote`,
  so a later-stacked note can never cover it and it keeps screen size at any zoom.
  `StickyNote` reports Dragging through an extra optional `onDragChange` prop so the toolbar
  hides while dragging; it also takes an optional `zIndex` prop.
- **`createSticky` with non-finite coordinates** returns `''` (falsy) instead of an id, since the
  contract's return type is `string`. No transaction is opened.
- **`moveObject` to the current position** returns `false` with no update (a no-op, like
  `bringToFront` on the topmost note). `setStickyColor` to the current colour likewise.
- **`bringToFront` with a tie** for topmost counts as "not topmost", so it raises the note.
- **Length limit while typing in the middle.** Beyond `clampToLimit` (required by the
  contract), the editor uses `limitEdit(prev, next)`: only the newly inserted characters beyond
  1,000 are dropped, so typing into the middle of a full note never pushes text off its end.
  For a paste into an empty note it is identical to `clampToLimit` (caret at end).
- **Surrogate pairs.** `clampToLimit` and `applyTextDiff` never split an emoji pair; the limit
  counts UTF-16 code units (what the textarea reports).
- **Keyboard.** Enter/Delete/Backspace act on the selected note, or on a note focused with Tab
  (so notes are reachable with Tab and editable with Enter). They are ignored while any note is
  being edited, when focus is in a text field or on a button, and with Ctrl/Cmd/Alt held.
- **Edit end.** Escape returns focus to the note element (still selected). Blur only flushes the
  pending value; editing ends on Escape or a pointerdown outside the note, per the design.
- **Vertical centring.** Display text is centred with flex auto margins, which fall back to
  top-aligned when the text overflows so clipping only happens at the bottom (under the fade).
  The textarea gets a matching top padding so text does not jump when editing starts.
- **Extra named settings:** `STICKY_PADDING_WORLD` (16), `BOARD_SCHEMA_VERSION` (1).
- **Test hook.** `window.__vidi6.doc` (the board `Y.Doc`) was added for component and e2e tests
  (TC-37 deletes through the model while dragging/editing). Still test-mode only; the
  production build was re-checked with grep.
- **Notes carry `data-x/y/z/color/state/selected/editing`** attributes for test assertions.
- **E2E browsers:** only Chromium is installed here, so e2e ran in Chromium only.
- **Manual checks** from tasks 4/5 (IME on macOS, trackpad feel) were not run by hand; IME is
  covered by a jsdom composition test and drag accuracy at 50%/200% by Chromium e2e.
- **Commits.** The whole story went into a single commit (per the session instructions) rather
  than separate test-first commits for tasks 1 and 3.

## Story 3 — See other people's edits appear live on the same board

- **Integration toolchain.** `@cloudflare/vitest-pool-workers` (latest 0.22) supports only
  vitest ^4.1, and fails to start under the app's vitest 5. The integration suite therefore has
  its own toolchain in `tests/integration/package.json` (vitest 4 + the pool), installed by the
  root `postinstall`, with its own `tests/integration/vitest.config.ts` (root = that directory so
  `vitest` resolves to v4). `npm run test:integration` builds the client first (the Worker's
  assets binding needs `dist/client`). It is not a project inside the root `vitest.config.ts`
  as the task suggests.
- **Compatibility date in integration.** The pool's bundled workerd supports dates up to
  2026-08-22, older than `wrangler.jsonc`'s 2026-09-17, so the integration config overrides
  `compatibilityDate` for tests only. `wrangler dev` (e2e) uses the real date.
- **Worker typecheck.** Worker code (`src/worker`, `tests/integration`) is checked by
  `tsconfig.worker.json` with `@cloudflare/workers-types` (no DOM). `npm run typecheck` runs both configs.
- **`binaryType = 'arraybuffer'`** is set on the room's server sockets: with the current
  compatibility date workerd delivers binary frames as `Blob` by default.
- **Invalid updates.** `y-protocols`' `readSyncMessage` swallows `applyUpdate` errors (it only
  logs them), so the room handles SyncStep1 itself and applies SyncStep2/Update with
  `Y.applyUpdate` directly. That way an invalid Yjs update closes the sender with 1003 (TC-15).
  `decodeMessage` also rejects a length prefix that runs past the end of the frame, unknown sync
  subtypes, and trailing bytes. For sync frames `payload` is the body after the message type.
- **`run_worker_first: ["/api/*"]`** in `wrangler.jsonc`, so room requests never hit the SPA
  fallback.
- **Routing.** `/b/:boardId` with a valid id opens that board. Any other address, including `/`
  and `/b/<invalid id>`, is replaced (history `replaceState`) with `/b/<newBoardId()>`. Story 5
  replaces this.
- **Remote typing while editing.** Story 2's editor read the `Y.Text` only when editing started,
  so its next local diff would have deleted text other people typed meanwhile. The editor now
  observes the `Y.Text`. It applies remote changes to the textarea and moves the caret and selection
  with them (`transformIndex`). During an IME composition, remote changes are held back; when the
  composition ends, they are merged and the composed edit is rebased onto them.
- **Delete during edit/drag** relies on story 2's App effect (a vanished selected note clears
  selection/editing; an unmounted `StickyNote` ends its drag silently). This is not a new
  `useSelection` hook.
- **Connection-state mapping.** Failures before the first sync keep "Connecting…". y-websocket
  emits `disconnected` only for a socket that had opened. `connectBoard` takes an optional
  4th argument (provider factory) so component tests can drive a fake provider. Component tests
  replace `WebSocket` with an inert stub (`tests/component/setup.ts`), so App-level tests never
  touch the network.
- **Test hooks (test mode only).** `window.__vidi6.connectionState` and
  `window.__vidi6Unmount()` (used by the TC-29 teardown check). The production build was
  re-checked with grep.
- **E2E latency** is measured in the pages. An init script records when each note property
  first shows a value on each screen, and latency is receiver time minus sender time. It is logged
  against `LIVE_UPDATE_LATENCY_BUDGET_MS` and never asserted. The zoom-label e2e helper and one
  component test now select the status role by name (`Zoom level`), because the connection badge
  is also `role="status"`.
- **Nightly.** TC-29/TC-30 are tagged `@nightly`. They run with `npm run test:e2e:nightly` and
  are excluded from `npm run test:e2e`. The 45 s idle and 60 s soak durations are test-local
  constants taken from the design. TC-30 participants edit only their own notes, each in its own
  screen band. This matches the design's "two writers different notes" class and keeps UI clicks
  deterministic.
- **E2E browsers:** only Chromium is installed here, so e2e (including TC-22/TC-23) ran in
  Chromium only.
- **Commits.** The whole story went into a single commit, per the session instructions.
