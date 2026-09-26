# Story 1: Pan and zoom around an infinite board — Implementation Notes

## What was built

A working React + Vite + TypeScript SPA with a camera-based infinite board viewport. The board
renders a subtle dot grid and a world-origin crosshair, with full pan and zoom controls.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/config.ts` | Shared constants (zoom min/max, step, grid spacing, hint key) |
| `src/client/canvas/camera.ts` | Pure camera maths: `screenToWorld`, `worldToScreen`, `panBy`, `zoomAt`, `zoomStep`, `resetCamera` |
| `src/client/canvas/useCamera.ts` | React hook managing camera state with viewport resize handling |
| `src/client/canvas/CameraContext.tsx` | React context for sharing camera state across components |
| `src/client/canvas/BoardViewport.tsx` | The board: dot-grid background, world layer, pointer/wheel/gesture/keyboard input |
| `src/client/canvas/ZoomControls.tsx` | Bottom-right zoom in/out/percent/reset control |
| `src/client/canvas/NavigationHint.tsx` | Dismissible onboarding hint |
| `src/client/canvas/testHooks.ts` | Test-only `window.__vidi6` hook (enabled in `--mode test` builds) |
| `src/client/App.tsx` | App shell composing the viewport, controls, and hint |

### Camera model

- State: `{ x, y, zoom }` — world coordinates at the viewport centre plus a zoom factor.
- `screenToWorld(p, cam, vp)` converts screen pixels to world coordinates.
- `worldToScreen(p, cam, vp)` converts world coordinates to screen pixels.
- `zoomAt(cam, point, factor)` zooms while keeping the world point under `point` fixed.
- `panBy(cam, dx, dy)` shifts the camera by screen-pixel deltas.
- Zoom range clamped to `[0.25, 4]`; step factor is 1.25 (or 0.8 inverse).
- Grid: CSS `radial-gradient` dot pattern on the viewport, size and position derived from camera state.
  At zoom 1 the dots are 24px apart (world units); at higher zoom the pattern scales up.

### Input handling

- **Pointer drag** (left button): `setPointerCapture` → `pointermove` deltas pan the camera.
  `pointercancel` and `pointerup` end the drag.
- **Wheel** (non-passive): plain scroll pans; `Ctrl+wheel` or `⌘+wheel` zooms at the cursor.
  `preventDefault()` on all handled events.
- **Pinch (Safari)**: `gesturestart`/`gesturechange`/`gestureend` with `preventDefault()`;
  scales around the gesture centroid.
- **Keyboard**: `Ctrl/⌘+=` zooms in, `Ctrl/⌘+-` zooms out, `Ctrl/⌘+0` resets.
  `preventDefault()` on all handled shortcuts.
- All gestures are board-local: `visualViewport.scale` and `devicePixelRatio` are never touched.

### Coordinate accuracy

- Pure CSS `transform: scale(zoom) translate(-cam.x, -cam.y)` on a `position: absolute` world layer.
- The dot-grid background uses `background-size` and `background-position` derived from the same
  camera values, so they stay in sync.
- No rounding is applied to camera state; only display values (zoom label) are rounded.
- This keeps the origin marker moving exactly 1 CSS pixel per screen pixel at zoom 1, even
  at coordinates like (1,000,000, 1,000,000).

### Testing strategy

- **Unit tests** (Vitest, no DOM): all camera maths functions tested for correctness, clamping,
  and round-trip conversions. 15 tests.
- **Component tests** (Vitest + jsdom + Testing Library): pointer drag, pointercancel, wheel pan,
  Ctrl+wheel zoom, gesture events, keyboard shortcuts, hint dismissal, zoom controls. 15 tests.
- **E2E tests** (Playwright, Chromium): real browser tests verifying pixel-exact drag movement,
  zoom-anchor correctness, hint lifecycle, limit clamping, far-travel accuracy, and page-zoom
  isolation. 7 tests.

### Test-only hook

`window.__vidi6.setCamera({x, y, zoom})` and `window.__vidi6.getCamera()` are available only
when the app is built with `--mode test` (`npm run build:e2e`). Used by e2e tests to jump
the camera to far coordinates.

### Local dev

```bash
npm install
npm run dev          # Vite dev server
npm run test         # Unit + component tests
npm run test:e2e     # E2E (builds test mode, starts vite preview)
npm run typecheck    # TypeScript
npm run build        # Production build → dist/client/
```

## Deviations from the spec

1. **Server**: Uses `vite preview` for e2e testing instead of `wrangler dev`. The wrangler config
   and worker stub are in place for story 3; the e2e `webServer` command can be switched back once
   the worker is functional. The playwright config currently uses `vite preview` for reliability.

2. **Workers**: Only Chromium is tested for e2e. Firefox and WebKit projects are defined in
   `playwright.config.ts` but the browsers are not installed in this environment. Run
   `npx playwright install --with-deps firefox webkit` to enable them.

3. **Grid rendering**: Uses CSS `radial-gradient` for the dot grid rather than a canvas element.
   This is simpler, GPU-accelerated, and keeps the world layer as pure DOM (consistent with
   story 2's plan for DOM-based sticky notes). The spec mentions "canvas layer for the grid" but
   the CSS approach is functionally equivalent and avoids mixing canvas + DOM compositing.

4. **Zoom step**: Uses 1.25× per step (not 1.2). This gives 7 steps from 100% to ~381%, then clamps
   at 400%, matching the PRD's "roughly seven steps to 400%".

---

# Story 2: Capture ideas on sticky notes and rearrange them — Implementation Notes

## What was built

Sticky notes on the board: create by double-click or toolbar button, edit text with automatic
font fitting, drag to move (zoom-accurate), recolour (6 colours), delete, and z-ordering
(bring-to-front on drag). All board state lives in a local `Y.Doc` from day one.

### Key files

| File | Purpose |
|------|---------|
| `src/shared/board-model.ts` | Framework-free board model on a `Y.Doc` (create/move/colour/delete/bringToFront/snapshot) |
| `src/client/board/useBoardDoc.ts` | Owns the `Y.Doc`; memoised snapshot via `useSyncExternalStore` |
| `src/client/board/useSelection.ts` | Local selection/editing state (never stored in the doc) |
| `src/client/objects/StickyNote.tsx` | Note element: select, drag, edit entry, font-fit mirror, fade, toolbar |
| `src/client/objects/StickyTextEditor.tsx` | Uncontrolled textarea: diff-based Yjs writes, IME, clamp, Escape, click-outside |
| `src/client/objects/StickyText.ts` | Pure text helpers: `clampToLimit`, `applyTextDiff`, `counterVisible`, `fitFontSize` |
| `src/client/objects/NoteToolbar.tsx` | Per-note colour swatches + delete, unscaled above the note |
| `src/client/board/Toolbar.tsx` | Global top toolbar with the Sticky note button |
| `src/client/App.tsx` | Wiring: keyboard shortcuts, selection, stale-state cleanup, stable note order |
| `tests/fixtures/texts.ts` | Realistic fixtures: short text, retro item, exactly 1,000 chars of prose |

### Board model

- `initDoc` sets `meta.schemaVersion` (persisted/wire format anchor for stories 3-4).
- Each successful mutation runs exactly one `doc.transact(fn, LOCAL_ORIGIN)`; rejections
  (stale id, unknown colour, non-finite coordinates) return `false`/`''` before any transaction,
  so failed calls emit no Yjs update (unit-asserted per call).
- Coordinates are the note's top-left; `createSticky` subtracts `STICKY_SIZE_WORLD / 2` so the
  note centres on the click point.
- `snapshot` returns notes sorted by `(z, id)`; unknown object types are skipped (forward-compat).

### Y.Doc ownership

`useBoardDoc` creates a single `Y.Doc` in `useState`, observes `objects` deeply, and recomputes
the memoised snapshot into a cache ref before notifying `useSyncExternalStore`. Rendering is
re-driven by snapshot reference change only.

### Stacking: z-index, not DOM order

Notes render in **stable creation order** and stack via CSS `z-index: note.z`. Rendering in z
order would make `bringToFront` (called at drag start) reorder the React children, moving the
dragging note's DOM node — and the browser **implicitly releases pointer capture when the
capturing node is moved**, which kills the drag after the first move (found via e2e TC-32).

### Text editing

- Uncontrolled textarea (`defaultValue`); `input` computes a character diff and applies it to
  `Y.Text` (one Yjs update per input event).
- Input beyond 1,000 chars is clamped; the caret moves to the end of the kept text.
- IME: `compositionstart/end` tracked; diffs only after composition end (manual-check scope).
- Escape ends editing keeping selection; click outside (window-level capture pointerdown) ends
  it unselected. Enter while selected starts editing with the caret at the end.
- Font fit: hidden mirror div (same width/font as display text) binary-searched 10-24px in
  0.5px steps on text change; overflow shows a transparent-to-colour fade at the bottom.
  The editor mirrors the same size. Re-fit is not needed on zoom (world units scale uniformly).

### Drag

3px screen-pixel threshold (below = select, not move). Movement is rAF-throttled
`moveObject`; `pointerup`/`pointercancel` flush the pending position synchronously, so the note
always ends exactly under the pointer. `bringToFront` runs once at drag start. If the note is
deleted mid-drag (`moveObject` returns false), the drag ends silently (TC-37).

### Keyboard (board level)

Enter edits the selected note; Delete/Backspace deletes it — only when not editing text
(guard: no active editing state and event target is not INPUT/TEXTAREA/contentEditable).

## Deviations / notes for story 2

1. **E2E viewport is 1280x720, not 1280x800.** The chromium project spreads
   `devices['Desktop Chrome']`, whose own viewport (1280x720) overrides the global `use.viewport`
   in `playwright.config.ts`. Initial camera is therefore `{x:-640, y:-360, zoom:1}`; the e2e
   specs compute coordinates from that. Left the config as-is (story 1 territory).

2. **React 19 test quirks handled in component tests:**
   - `useSyncExternalStore` updates triggered by programmatic `el.click()` are not flushed
     synchronously; use RTL `fireEvent.click` (wraps in `act()`) or wrap in `act()`.
   - No global `JSX.Element` namespace — components return `ReactElement`.
   - Uncontrolled textarea value changes in tests need `fireEvent.input` (native setter)
     to fire React's `onChange`; assigning `.value` + dispatching does not.

3. **Test-only hooks extended:** `window.__vidi6.getNotes()` (snapshot) and `getDoc()` (the
   `Y.Doc`, for direct model calls from tests), enabled in `--mode test` builds only.

4. **Test counts:** 40 unit (15 camera, 15 board model, 10 sticky text), 39 component, 13 e2e
   (6 story 1 + 7 story 2). All green on Chromium.

5. **500-note performance run** remains a manual script (not a CI gate) per the design doc;
   the z-index stacking keeps per-note re-renders local to the mutated note's style.

## Local dev

```bash
npm run test:unit
npm run test:component
npm run test:e2e -- --project chromium
npm run typecheck
npm run build
```

# Story 5: Share a board with others using a link — Implementation Notes

## What was built

Boards are now addressable: `POST /api/boards` creates one (rate-limited), `GET
/api/boards/:id` checks existence, and `/b/:id` renders the board for any visitor.
Unknown or malformed ids land on a not-found page. The board page shows a share
panel (copy link) for the creator.

### Key files

| File | Purpose |
|------|---------|
| `src/worker/create-board.ts` | id generation (crypto, 3 retries), fixed-window rate limit (binding or in-memory fallback), DO `initialize()` RPC |
| `src/worker/index.ts` | `POST /api/boards`, `GET /api/boards/:id`; `/api/rooms/:id` now 404s unknown/malformed ids (was 400) |
| `src/worker/board-store.ts` | lazy tables: created by `initialize()`/first write instead of at DO construction; `existsReadOnly()` for the existence check |
| `src/worker/board-room.ts` | `extends DurableObject`; `initialize()`/`exists()` RPC; `fetch()` 404s unknown boards |
| `src/worker/test-hooks.ts` | `initialize`, `exists`, `seed-legacy` ops (plus `x-test-visitor`, `x-test-create-ids`, `x-test-fail-initialize` headers) |
| `src/client/router.ts` | tiny hashless router: `parseRoute`, `useRoute` (`useSyncExternalStore` + `popstate` + `getSnapshot` re-sync), `navigate` |
| `src/client/api.ts` | `checkBoard`, `createBoardRequest` |
| `src/client/pages/` | `HomePage` (create), `BoardPage` (existence check + exponential-backoff retry), `NotFoundPage`, `useCreateBoard` |
| `src/client/share/SharePanel.tsx` | copy-to-clipboard link panel (Clipboard API + manual fallback, Escape/outside close) |
| `src/client/board/Board.tsx` | board surface extracted from `App.tsx`; exports `canEdit` |
| `index.html` | `<meta name="referrer" content="no-referrer">` so share links leak no referer |

### Design decisions

- **Rate limiting.** `wrangler.jsonc` declares a `BOARD_CREATE_LIMITER` ratelimit
  (10/60s). Local workerd does not support ratelimit bindings, so the worker falls
  back to an in-memory fixed-window limiter keyed by visitor when the binding is
  undefined; production uses the real binding. Visitor key: cookie or
  `x-test-visitor` (test override keeps parallel e2e creations independent).
- **Lazy migration.** `migrate()` no longer runs at DO construction; a fresh board
  has no tables until `initialize()` or the first write. `existsReadOnly()` treats
  "tables exist but empty" as a non-board so 404 stays correct.
- **`extends DurableObject`.** Local workerd requires `extends DurableObject`
  (from `cloudflare:workers`) for RPC; `implements` does not work locally.
- **BoardPage retry.** Existence-check failures retry with exponential backoff
  (base 1s, capped at `RECONNECT_MAX_BACKOFF_MS`) to ride out DO cold starts.
- **Router `getSnapshot` re-sync.** Re-parses `location.pathname` every call so
  external `pushState` (tests, `window.location` edits) is picked up without a
  `popstate` event; the cached route object only changes when the route changes
  (stable snapshots for `useSyncExternalStore`).

### Test notes

- **Component tests:** `renderFullApp` is async (BoardPage performs an existence
  check in a microtask); all full-app renders `await` it and mock `@/client/api`.
- **RoomClient `autoInit`:** the integration `ws-client` calls the `initialize`
  hook before connecting (default on), matching what a real browser does via
  BoardPage's check.
- **TC-31 (legacy data):** legacy rows are seeded with `seed-legacy`, then
  `simulate-reconstruct` forces the room's doc to reload from storage (the room
  instance is reused by the WS and predates the seeded rows).
- **TC-21 race (persistence):** the y-websocket provider flushes client doc
  updates asynchronously; `broadcastMessage` silently drops updates while the
  socket is not open, and closing the page drops frames still in flight. The
  test now waits until `load-fresh` reports all seeded notes are durable before
  compacting and closing the seed page.
- **yjs v13:** no `encodeUpdateAsBase64` export — use
  `Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')`.
- **Playwright:** `test.describe` + `test.describe.configure({ timeout })`
  (no top-level `describe`, no 3rd-arg `test()` timeout in this version).
