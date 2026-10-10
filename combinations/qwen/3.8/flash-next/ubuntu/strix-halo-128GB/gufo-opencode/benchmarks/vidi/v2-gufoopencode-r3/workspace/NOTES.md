# Notes

Decisions and deviations for story 1 (Pan and zoom around an infinite board).

## Architecture
- Camera state lives in a `useCamera` hook (`src/client/canvas/useCamera.ts`) owned by
  `App.tsx` and shared through `BoardCameraContext`, so `ZoomControls` and the
  navigation hint can drive/observe the same camera as `BoardViewport`.
- All camera mutations funnel through pure functions in `src/client/canvas/camera.ts`
  (zoom-at-point, pan, clamp, reset) which are unit-tested without a DOM.
- Camera commits are coalesced with `requestAnimationFrame`, so one drag gesture
  produces at most one React render per frame.
- Named settings (`ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP_FACTOR`, `WHEEL_ZOOM_SENSITIVITY`,
  `GRID_SPACING_WORLD`, `UNBOUNDED_PAN_TESTED_EXTENT`) live in `src/shared/config.ts`
  and are imported by both app code and tests.
- The dot grid is CSS `radial-gradient` background on the viewport with
  `background-position: mod(-camera.x * zoom, spacing)`; this keeps grid spacing exact
  and jitter-free at world coordinates up to ±1,000,000 (TC-27).
- Pointer Events are used for panning with `setPointerCapture` (guarded, since jsdom
  lacks it). Ctrl/Cmd + wheel zooms around the cursor with `preventDefault` so the
  browser page never zooms (TC-31 asserts `visualViewport.scale` / dpr stay constant).
  Keyboard: +/-/0 zoom at viewport centre; arrows/space pan.
- A `data-testid="origin-marker"` world-space element gives tests a measurable point
  (present in all builds; only the `window.__vidi6` camera-set hook is gated behind
  `import.meta.env.MODE === 'test'` via `src/client/canvas/testHooks.ts`).

## Testing deviations / environment
- jsdom has no `PointerEvent`, so `tests/component/setup.ts` shims it as a `MouseEvent`
  subclass (clientX/clientY/button/pointerId survive like in real browsers). Handlers
  and assertions are otherwise unmodified.
- E2E servers: Playwright's `webServer` runs `wrangler dev` (Cloudflare Pages static
  assets from `dist/client`) on port 22704 (inspector 22705) per the allowed-port
  rules; `npm run test:e2e` builds with `vite build --mode test` first.
- Browser matrix: the config defines chromium, firefox and webkit projects, but probes
  each binary (`executablePath` + `--version`) at config load and skips unusable ones
  with a warning. On this machine only the cached Chromium build works: Firefox/WebKit
  downloads fail host-dependency validation and there is no sudo to run
  `npx playwright install-deps`. All 8 e2e tests pass in Chromium (rules: Chromium
  success suffices); Firefox/WebKit run automatically wherever their binaries exist.
- TC-25 loop tolerates the "+" button disabling between the `isDisabled()` check and
  the `click()` (Playwright actionability would otherwise hang).

---

# Story 2: Capture ideas on sticky notes and rearrange them

## Architecture
- The Yjs document schema and all mutations live in `src/shared/board-model.ts`
  (`objects: Y.Map` of sticky `Y.Map`s with `type,x,y,color,z,createdAt` and a
  `Y.Text` per note; `initDoc`, `createSticky`, `moveObject`, `setStickyColor`,
  `deleteObject`, `bringToFront`, `snapshot`). All mutations wrap writes in
  `doc.transact()` with `LOCAL_ORIGIN`.
- `useBoardDoc` (`src/client/board/useBoardDoc.ts`) owns the single local
  `Y.Doc`, subscribes with `observeDeep` on `objects` and exposes an
  immutable snapshot through `useSyncExternalStore`. Selection and editing
  (`useSelection`) are per-client React state, never stored in the doc.
- `StickyNote` drag: pointerdown arms the interaction; movement begins at
  `DRAG_THRESHOLD_PX` (screen px) with `bringToFront`; positions are written
  through a `requestAnimationFrame` pump (one `moveObject` per frame, latest
  position wins). On release the pending position is flushed synchronously
  (otherwise a down→move→up inside one frame would drop the final move);
  `pointercancel` instead freezes at the last applied position (TC-21).
  Deltas are divided by camera zoom so the grabbed point stays under the
  pointer (TC-31/32).
- Text editing uses a plain `<textarea>` overlay diffed into the `Y.Text` on
  every `input` event via `applyTextDiff` (minimal common prefix/suffix
  insert/delete; surrogate-pair boundaries are never split), so ending
  editing never needs an extra write and story-3 CRDT typing stays safe.
  IME composition is skipped until `compositionend`. Inputs are clamped to
  `STICKY_TEXT_MAX_CHARS` inside the editor.
- Auto-fit font size: a hidden measure div (same font/line-height, wrapped
  to the text box width) is stepped from `STICKY_FONT_MAX_PX` down to
  `STICKY_FONT_MIN_PX`; if even the minimum overflows, a fade class
  (`sticky-note--overflow::after`) marks clipped text.
- Toolbars: left `Toolbar` has the Sticky note button (creates at viewport
  centre, zoom-aware); the floating `NoteToolbar` (screen-space, anchored
  above the selected note) offers 6 colour swatches + delete, and hides
  while dragging or editing. Keyboard: Enter edits the selected note,
  Delete/Backspace delete it (both no-ops while a text field has focus or
  while editing, so TC-26's backspace-while-typing only deletes a character).

## Contract deviations / decisions
- `createSticky` with non-finite coordinates throws `TypeError` instead of
  returning `false`: the design contract types its return as `string`, so a
  `false` is unrepresentable; throwing is the only loud option and user
  input can never produce non-finite points (TC-39 covers the sibling
  `moveObject`, which does return `false`).
- `setStickyColor` returns `false` when the colour is unchanged (contract:
  "true if changes applied"); the doc gets 0 updates in that case.
- `useSelection` exposes two extras beyond the design contract:
  `draggingId` + `setDragging`, purely to hide the note toolbar while
  dragging (local-only, never in the doc). `StickyNote` therefore takes an
  optional `onDraggingChange` prop.
- `StickyTextEditor` detects outside clicks with a `pointerdown` listener on
  `window` in capture phase, because note/toolbar `stopPropagation` would
  otherwise hide board clicks from it.
- `App` accepts an optional `doc` prop and `useBoardDoc(provided?)` a doc, so
  component tests can create fixtures and assert model state directly.
  `window.__vidi6` gained `getNotes()` (test-mode only, like `setCamera`),
  and `StickyNote` renders `data-id` for e2e targeting.
- `EndEditNext` is exported from `src/client/objects/StickyText.ts`.
- Notes are centred on the creation point: stored `x,y = point −
  STICKY_SIZE_WORLD/2` (per design); tests account for it.

## Testing notes
- jsdom lacks `ResizeObserver`/pointer capture; both are feature-guarded with
  fallbacks (window resize listener; plain event flow).
- `tests/e2e/sticky.spec.ts` (TC-30–34) uses `window.__vidi6.setCamera` to
  jump to 50%/200% zoom or far-away pan instead of gestureing thousands of
  pixels; long-text paste goes through the native textarea value setter so
  React's `onInput` commits it.
- E2E runs Chromium-only here (same environment constraint as story 1).

---

# Story 3: See other people's edits appear live on the same board

## Architecture
- `BoardRoom` Durable Object (`src/worker/board-room.ts`): non-hibernating
  `accept()` (the Y.Doc lives in memory); sends SyncStep1 on open, relays
  every applied doc update to the other sockets with
  `syncProtocol.writeUpdate` framing (raw `frame(MESSAGE_SYNC, update)`
  breaks clients: update bytes get parsed as sync messages). Awareness
  messages are relayed verbatim; anything the decoder/sync layer rejects
  closes with 1003.
- The Worker entry (`src/worker/index.ts`) routes `/api/rooms/:boardId` to
  the DO stub (`getBoardRoom(getRoomId(env, boardId))`) and falls through to
  static assets. Board id validation (`src/shared/board-id.ts`) rejects
  ids that would break URL/DO-name encoding.
- Client: `connectBoard(doc, boardId)` (`src/client/sync/connectBoard.ts`)
  wires a y-websocket `WebsocketProvider` to a pure state machine
  (`createSyncStatusMachine`) exposed through `useBoardDoc`. States:
  connecting → connected; after a first sync an outage shows reconnecting,
  and reconnect needs `CONNECTED_CONFIRMATION_MS` (2 s) of confirmed sync
  before the badge flips to Connected, then hides.
- Provider sync event is `'sync'` (not `'synced'`) in y-websocket 3.x.
- `/b/:boardId` is handled client-side (`resolveBoardId` in `App.tsx`);
  wrangler dev rewrites unknown paths to index.html via SPA fallback.

## Gotchas (cost hours)
- **workerd delivers WS frames as `Blob`, not `ArrayBuffer`.** `event.data`
  in `fetch`-based DO websockets under current workerd is a Blob; the
  protocol decoder must `await blob.arrayBuffer()` (and also accept
  ArrayBufferView for the Node/vitest path). Without this every message
  decoded as invalid → 1003 close loops.
- `Y.Doc.toJSON()` only serialises shared types **already instantiated** via
  `doc.getMap(...)` etc. A doc that received updates but never called
  `getMap('objects')` returns `{}` even though the data is applied. Always
  instantiate the root map before snapshotting (`snapshot()` in the board
  model does this).
- `setOffline(true)` does **not** close established WebSockets in Chromium;
  outage detection relies on y-websocket's 30 s "no message received"
  watchdog, so e2e outage tests budget ~35 s for the Reconnecting badge.
- Room badge locator must be `.connection-status`, not
  `getByRole('status')`: the zoom label `<output>` has implicit
  role=status and makes strict-mode locators ambiguous.

## Testing notes
- Integration project (`vitest-pool-workers` 0.12.0) uses
  `isolatedStorage: false`: live DO websockets keep storage busy so the
  per-test storage snapshot restore cannot work; tests use random board
  ids instead. `testTimeout: 30_000` for DO startup.
- `tests/integration/ws-client.ts` is a tiny y-protocol client (Node `ws`)
  used by the workerd tests; `random-ops.ts` drives merge scenarios.
- E2E helpers (`tests/e2e/helpers/participants.ts`): `openParticipants`
  opens N isolated contexts on one board id, `waitForSynced` gates on the
  `connectionState()` test hook, `LatencyRecorder` measures peer-visibility
  latency per change and logs p50/p95/max against
  `LIVE_UPDATE_LATENCY_BUDGET_MS` (reported, asserted only for the
  functional TC-22..28 single-change waits).
- Nightly (`npm run test:e2e:nightly`, @nightly grep): TC-29 five idle
  clients for 45 s (badge must never appear; awareness relay keeps the
  watchdog fed), TC-30 five seeded random editors for 60 s asserting
  convergence of every change (exact deltas are not asserted because a
  drag may grab an overlapping note; convergence is the contract).
- Observed latency on this machine: p50 ≈ 6–18 ms, p95 ≈ 9–53 ms,
  worst single sample 114 ms — far under the 1 s budget.
