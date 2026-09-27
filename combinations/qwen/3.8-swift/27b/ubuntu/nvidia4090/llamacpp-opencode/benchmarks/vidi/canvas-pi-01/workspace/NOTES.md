# Story 1 — Notes

Pan and zoom around an infinite board. All tests pass:

- `npm run typecheck` — clean
- `npm run test:unit` — 16/16 (camera maths, TC-01..12 + property check)
- `npm run test:component` — 19/19 (TC-13..22, 29, 30, 32 + extras)
- `npm run test:e2e` — 12/12 (4 tests × chromium/firefox/webkit, via `wrangler dev`)
- `npm run build` — production bundle builds; the `window.__vidi6` test hook is
  absent from production output (guarded by `import.meta.env.MODE === 'test'`)

## Design contract extensions

The implementation keeps the design contract and adds members it needs; nothing
in the contract was changed or removed.

### `useCamera` return value (`CameraApi`)

Beyond `camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset`:

- `panning: boolean` — true while a pointer drag is in progress; the viewport
  renders `data-panning` and a `grabbing` cursor from it, and TC-13/TC-14 assert
  the Idle → Panning → Idle cycle through it.
- `gestureStart(): void`, `gestureChange(scale: number, point: Point): void` —
  Safari trackpad pinch (the design lists `gesturestart/gesturechange` as
  inputs; the contract signature list omitted the corresponding hook methods).
- `setCamera(cam: Camera): void` — test-only camera jump; wired to
  `window.__vidi6.setCamera` in `testHooks.ts`, enabled only in test mode.

### `BoardViewport` props

The design shows `BoardViewport({ children? })`; the implementation is
`BoardViewport({ children?, cam: CameraApi })`. `App` owns the single
`useCamera` instance (so the viewport, zoom controls and hint share one camera)
and injects it as a prop — matching the structure diagram, where everything
wires to the one hook.

## Decisions and deviations

- **`wrangler.jsonc`**: no `assets.binding`. Wrangler 4.141 rejects an
  assets-only config that declares a binding without a Worker `main`. The
  `ASSETS` binding returns in story 3 together with the Worker script.
- **E2E build**: `npm run build:e2e` (`vite build --mode test`) so the
  `__vidi6` hook exists in the bundle served to the e2e suite; `npm run build`
  (production mode) excludes it.
- **E2E drag robustness (WebKit)**: WebKit + Playwright can deliver synthetic
  `pointerdown` late (after queued `pointermove`s) or drop it under load.
  `dragBoard` in `tests/e2e/helpers/board.ts` verifies `data-panning` after
  `mouse.down()` and retries if the down was lost; a shortfall pass compensates
  for coalesced `pointermove` events so the asserted net pan is exact.
  The app code itself is unchanged by this — moves before `pointerdown` are
  simply ignored by the hook.
- **Transform assertions are numeric**: JS stringifies `±1000000` as
  `±1e+06` in inline styles, so e2e helpers parse the world-layer transform
  and compare numbers, not strings.
- **Grid rendering**: the dot grid is a CSS `radial-gradient` background on the
  viewport with `background-size = GRID_SPACING_WORLD * zoom` and
  `background-position` wrapped with a positive modulo — even at zoom 0.1 far
  from the origin (TC-27).
- **Origin marker**: a small crosshair at world (0,0) (`data-testid="origin-marker"`)
  so e2e can measure "the board's starting point" directly.

## Test-to-spec map

- `tests/unit/camera.test.ts` — TC-01..12 + a seeded property check
  (round-trip / invariance, clamping, drift over 10 000 zoom steps).
- `tests/component/BoardViewport.test.tsx` — TC-13..18, TC-29, TC-30 +
  deltaX wheel panning + drag-target restriction.
- `tests/component/ZoomControls.test.tsx` — TC-19..21, TC-32.
- `tests/component/NavigationHint.test.tsx` — TC-22 + visibility/positioning.
- `tests/e2e/navigation.spec.ts` — TC-23..28, TC-31 (three design workflows +
  page-zoom isolation), on chromium, firefox and webkit.

# Story 2 — Notes

Capture ideas on sticky notes and rearrange them. All tests pass:

- `npm run typecheck` — clean
- `npm run test:unit` — 41/41 (camera 16 + board-model TC-01..12 = 15 + sticky-text TC-13..17 = 10)
- `npm run test:component` — 40/40 (sticky.interaction TC-18..22/25/35..37, sticky.text TC-23/24/26/38, sticky.toolbar TC-27..29 + standalone drag-state-machine tests)
- `npm run test:e2e` — 30/30 (navigation 4 + sticky-notes 6, × chromium/firefox/webkit)
- `npm run build` — production bundle builds; `window.__vidi6` excluded (test-mode guard)

## Decisions and deviations

- **`createSticky` rejection**: non-finite coordinates return `''` (no id),
  matching the board-model contract in the design.
- **Drag end notification**: `onDraggingChange(null)` fires only if a real
  drag (≥ `DRAG_THRESHOLD_PX`) started, so a plain click never emits a
  start/end pair (TC-19: "no onDraggingChange calls").
- **Pointer capture vs. z-reorder**: bringing a note to the front on drag
  start reorders the DOM (React `insertBefore` removes the node transiently),
  and browsers release pointer capture on removal. Two consequences:
  - a defensive `onLostPointerCapture` handler would abort the drag, so it was
    not used — real cancellations arrive as `pointercancel` (TC-21);
  - the capture is re-acquired in a post-commit effect once `dragging` turns
    true, so the drag keeps receiving pointer events even when the pointer
    outruns the note.
  This only matters for notes that are *not* already topmost (single-note
  boards no-op in `bringToFront` and never reorder).
- **Component tests under fake timers**: React 19's scheduler cannot run
  scheduled tasks while time is frozen, so raw `dispatchEvent` interactions
  leave state unflushed. `tests/component/helpers.tsx` wraps clicks/keys/input
  in `act()` (`click`, `keyOn`, `windowKey`, `inputValue`, `dispatch`).
- **jsdom colour normalisation**: inline `#F48FB1` reads back as
  `rgb(244, 143, 177)`, so TC-27 asserts the rgb form.
- **E2E drag robustness (sticky notes)**: `dragNote` probes 3px after
  `mouse.down()` and verifies `data-dragging="true"` on the note *under the
  grab point* (not the first DOM note) before committing; `dragNoteExactly`
  measures the dragged note's centre before/after and compensates dropped
  `pointermove` events (WebKit) so asserted movements are exact.
- **E2E camera fixtures**: `screen = zoom · (world − camera)`, so keeping
  world (0,0) at screen (640,400) needs camera `(−640/z, −400/z)`: 50% →
  (−1280,−800), 200% → (−320,−200).
- **E2E doc inspection**: `page.evaluate` reads the Y.Doc through
  `window.__vidi6.getDoc()`; `Y.Map` items require `.get('x')`, not
  property access, and evaluate callbacks must be self-contained (no
  module-scope references).

## Test-to-spec map (story 2)

- `tests/unit/board-model.test.ts` — TC-01..12 (each mutation test asserts
  the `update` event count: 1 on success, 0 on rejection).
- `tests/unit/sticky-text.test.ts` — TC-13..17.
- `tests/component/StickyNote.test.tsx` — TC-18..22, TC-25(+b), TC-35..37
  (app level) + standalone drag-state-machine tests against a real Y.Doc
  (threshold, zoom division, pointercancel, deletion mid-drag).
- `tests/component/StickyTextEditor.test.tsx` — TC-23, TC-24, TC-26, TC-38.
- `tests/component/Toolbars.test.tsx` — TC-27..29.
- `tests/e2e/sticky-notes.spec.ts` — TC-30..34 + the brainstorm golden path,
  on chromium, firefox and webkit.
- `tests/fixtures/texts.ts` — shared prose fixtures (short phrase, 1,000 and
  1,200 character paragraphs).

# Story 3 — Notes

See other people's edits appear live on the same board. All tests pass:

- `npm run typecheck` — clean (client + worker tsconfigs)
- `npm run test:unit` — 60/60 (board-model, board-id, protocol, sticky-text incl. `shiftCaret`)
- `npm run test:component` — 44/44
- `npm run test:integration` — 18/18 (BoardRoom real-worker sync TC-07..18/31 + worker entry routing)
- `npm run test:e2e` — 17/17 on chromium (navigation 4 + sticky-notes 6 + live-collaboration 7, TC-22..28); TC-22/TC-23 also pass on firefox and webkit
- `npm run test:e2e:nightly` — 2/2 (TC-29 idle 45 s; TC-30 capacity)
- `npm run build` — production bundle builds; `window.__vidi6` excluded (test-mode guard)

## Nightly results (recorded per spec)

Both nightly tests pass on this machine:

- **TC-29** (idle connection stays `connected` for 45 s) — **pass**. The
  awareness heartbeat + room relay defeat y-websocket's 30 s no-message watchdog.
- **TC-30** (continuous edits at `MAX_CONCURRENT_EDITORS` deliver within budget) —
  **pass**. Delivery latency over 40 measured changes: **p50 = 28 ms,
  p95 = 61 ms, max = 100 ms** (budget `LIVE_UPDATE_LATENCY_BUDGET_MS` = 1000 ms).

## Decisions and deviations

- **WebSocketPair / WebSocket are workerd globals**: only `DurableObject` is
  imported from `cloudflare:workers`. The upgrade response uses the new
  `{ status: 101, webSocket: client }` form (not `body`).
- **`SELF.fetch` needs absolute URLs** and returns a `Response` whose
  `.webSocket` is the server socket (call `.accept()` on it).
- **Raw Yjs updates are not sync messages**: the room wraps broadcast updates
  with `syncProtocol.writeUpdate` (type prefix) before sending, mirroring
  y-websocket.
- **y-protocols swallows Yjs update errors** unless an `errorHandler` (5th arg to
  `readSyncMessage`) is supplied; the room uses it to close the offending socket
  (TC-15).
- **Offline catch-up**: y-websocket only sends a state vector (SyncStep1) on
  (re)connect, so local edits made while offline are lost. `connectBoard` sends a
  full `Y.encodeStateAsUpdate(doc)` update on every `connected` status; the doc is
  small (a whiteboard), so this is cheap and guarantees no offline edit is dropped
  (TC-27).
- **Connection badge states**: `connecting → connected` (hidden) on first connect;
  `disconnected`/`connecting` after having connected → `reconnecting`
  ("Reconnecting…"); re-`connected` → `confirmed` (green "Connected" for
  `CONNECTED_CONFIRMATION_MS`) → back to `connected` (hidden).
- **TC-27 badge timing**: the browser does not reliably fire WebSocket `close` on
  network loss (a known y-websocket limitation), so the provider only notices the
  drop via its 30 s no-message watchdog. The test allows 40 s for the
  "Reconnecting…" badge to appear; the authoritative assertions are that both
  pages converge on all 6 notes and the badge is hidden after reconnection.
- **Concurrent typing**: `StickyTextEditor` observes `Y.Text` for remote changes
  and re-syncs the textarea while preserving the caret via `shiftCaret` (a pure
  delta→caret mapper, unit-tested); local-origin transactions are skipped.
- **IDs are per-client**: note ids are `crypto.randomUUID()` (not Yjs counters),
  so they differ between peers; integration snapshot comparison excludes `id` and
  `createdAt`.
- **tsconfig split**: the main config excludes `src/worker` and `tests/integration`;
  `tsconfig.worker.json` typechecks the worker against `@cloudflare/workers-types`.
- **vitest projects**: unit/component run on the `forks` pool; integration runs on
  `@cloudflare/vitest-pool-workers` with `singleWorker: true` + `isolatedStorage:
  false` (avoids workerd's 255-char path limit and the sqlite sidecar-file
  assertion). Integration tests are run through the `/tmp/vidi6ws` symlink for the
  same path-length reason.

## Test-to-spec map (story 3)

- `tests/unit/board-id.test.ts` — id shape / validation / generation.
- `tests/unit/protocol.test.ts` — frame encode/decode round-trips + malformed input.
- `tests/unit/sticky-text.test.ts` — TC-13..17 + `shiftCaret` (remote-delta caret
  mapping).
- `tests/component/ConnectionStatus.test.tsx` — badge text / visibility per state.
- `tests/component/StickyTextEditor.test.tsx` — remote-change re-sync + caret.
- `tests/integration/board-room.test.ts` — TC-07..18, TC-31 against the real
  worker (two/three clients, malformed frames, board isolation, idle keep-alive).
- `tests/integration/worker.test.ts` — `/api/rooms/:boardId` routing (valid/invalid
  id, upgrade required).
- `tests/e2e/live-collaboration.spec.ts` — TC-22..28 (chromium; TC-22/23 also
  firefox/webkit).
- `tests/e2e/nightly/idle.spec.ts` — TC-29.
- `tests/e2e/nightly/capacity.spec.ts` — TC-30.

## Decisions and deviations (story 7)

- **`ObjectSnapshot` is generic over type**: `board-model.ts` now works on
  `{ id, type, x, y, width?, height?, color?, text?, z }` so group operations
  (`moveObjects`, `resizeObjects`, `deleteObjects`, `bringObjectsToFront`,
  `objectsInRect`) are type-agnostic. `StickySnapshot` extends it with the
  sticky-required fields; stories 9–12 add their own extensions. `snapshot(doc)`
  and `allObjectIds`/`objectsInRect` skip objects whose `type` is not registered
  (`isKnownObjectType`), so unknown types never throw (TC-12).
- **Registry**: `src/client/objects/registry.tsx` maps a type name to a spec
  (`Component`, `resizable`, `aspectLocked`, `minSize`). `registerObjectType`
  throws on duplicate registration (unit-tested). Only `sticky` is registered in
  app code; the `testbox` fixture (resizable, not aspect-locked, minSize 10) is
  registered in component tests to prove the generic resize path.
- **Aspect lock is a selection property**: a resize unifies its scale when any
  selected spec is `aspectLocked` **or** Shift is held. In `useTransformGesture`
  the unified scale is `s = min(clamped.x, clamped.y)` so both axes stay equal;
  `scaleWithin` then maps every object rect through the same scale about the
  bounding-box origin, which keeps gaps proportional.
- **Absolute writes from gesture start**: each frame writes `startRect + delta`
  (move) or `scaleWithin(startRect, startBox, targetBox)` (resize) — never
  accumulated per-frame deltas — so concurrent remote moves converge to the last
  writer identically on every screen (TC-36).
- **Stacking**: a group move calls `bringObjectsToFront`, which reassigns
  `z = maxUnselectedZ + rank` preserving relative order among the selected
  objects; it returns 0 (no transaction) when the order is already correct.
- **Selection bar count is an `aria-live` region for any selection**: the
  visible "N selected" bar renders at ≥ 2 objects (with Delete); a single sticky
  shows the story-2 `NoteToolbar`. A separate `.sr-only` `aria-live="polite"`
  span announces the count for **any** non-empty selection (design contract),
  which is what the e2e TC-35 prune assertion reads ("2 selected" → "1 selected").
- **Load-failed is read-only, not selection-free**: a click still selects the
  note (harmless highlight) but `useTransformGesture` is handed an empty id set
  so no gesture starts and nothing is written (TC-25).
- **`endEdit(next)`**: the editor reports how editing ended — Escape →
  `'selected'` (the note stays selected), click-outside → `'unselected'`
  (deselects). The reducer's `end-edit` action carries that flag.
- **Marquee is world-space**: `useMarquee` converts screen→world via the camera
  and `MarqueeRect` renders inside the scaled world layer, so the rubber band
  tracks the board at any zoom. `objectsInRect` selects objects lying *entirely*
  inside (a partly-inside object is not selected, TC-07/TC-32).
- **e2e fixtures place notes at exact world coordinates** via a new
  `window.__vidi6.createNoteAt(x, y)` test hook (a `createSticky` wrapper), and
  assertions read world state back from the Y.Doc so camera rounding never
  matters. `homeCam(page)` derives the home camera from each page's *actual*
  viewport because `openParticipant` contexts do not inherit the project's
  800 px-tall viewport (default is 720).
- **e2e input-drop hardening**: WebKit/Firefox drop clicks and drags under
  parallel load (the pre-existing specs retry for the same reason). `clickNoteAt`
  verifies the selection and retries; TC-36's per-editor drag self-heals by
  re-dragging from the note's actual position until it reaches its target.

## Test-to-spec map (story 7)

- `tests/unit/geometry.test.ts` — TC-01..04 + `scaleWithin`/`clampScale`/
  `unionRects`/`normalizeRect`/`pointInRect`/`rectContains`.
- `tests/unit/board-model-group.test.ts` — TC-05..10 (group move/resize/delete/
  bring-to-front/objectsInRect/allObjectIds).
- `tests/unit/registry.test.ts` — TC-11, TC-12 + duplicate registration throws.
- `tests/unit/selection.test.ts` — TC-13..15 + end-edit selected/unselected.
- `tests/component/selection.test.tsx` — TC-16..19, TC-27..31.
- `tests/component/marquee.test.tsx` — TC-20..22.
- `tests/component/transform.test.tsx` — TC-23..26.
- `tests/fixtures/testbox.tsx` — test-only non-locked resizable type.
- `tests/e2e/select-move-resize-delete.spec.ts` — TC-32..36 (chromium/firefox/
  webkit).
