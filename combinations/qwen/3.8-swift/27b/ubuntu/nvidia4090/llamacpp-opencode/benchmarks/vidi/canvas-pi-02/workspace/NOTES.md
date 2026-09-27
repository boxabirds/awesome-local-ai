# vidi6 — Notes

## Story 1: Pan and zoom around an infinite board

### How it works

The board is a DOM element ("the world") inside a full-window viewport. The
camera is the world's CSS transform:

```
transform: scale(zoom) translate(-camera.x px, -camera.y px)
```

Screen ↔ world conversion (all in `src/client/canvas/camera.ts`, pure and
unit-tested):

```
screen = world * zoom + (viewport/2) - camera * zoom
world  = (screen - viewport/2) / zoom + camera
```

- **Pan** — pointer drag anywhere on the board (pointer capture, works for
  touch/pen/mouse alike).
- **Zoom** — Ctrl/Cmd+wheel zooms around the pointer (anchor-preserving);
  `+`/`-`/`0` zoom around the viewport centre; buttons in the bottom-right
  control cluster. Zoom is clamped to 25%–400% (`MIN_ZOOM`/`MAX_ZOOM`);
  buttons disable at the limits.
- **Reset** — back to 100% with the origin centred.
- **Grid** — an SVG `<pattern>` dot grid whose spacing is
  `GRID_SPACING_WORLD` (24) world units, so it scales and travels with the
  board; at 1,000,000 units the spacing is still exactly `24 * zoom` px.
- **First-use hint** — visible until the first pan or zoom (this visit only).
- **No page zoom** — board wheel handlers are non-passive and call
  `preventDefault`; keyboard zoom uses `event.defaultPrevented` guards.

### Camera updates are batched to one render per frame

`useCamera` accumulates navigation into a `pendingRef` and commits to React
state from a `requestAnimationFrame` callback (plus a 32 ms
`CAMERA_FLUSH_FALLBACK_MS` timer). The timer is a safety net: headless WebKit
(WPE) only produces paint frames when content is dirty, so an rAF scheduled
during a drag can starve — the timer guarantees the flush happens.

### Test-mode hook

In `--mode test` builds, `window.__vidi6.setCamera(x, y, zoom)` jumps the
camera exactly (used by e2e for far-travel and reset tests). The `import.meta.env.MODE`
branch is dead-code-eliminated in production builds (verified: the string
`__vidi6` is absent from the prod bundle).

### Test matrix

| Suite            | Command            | Count |
| ---------------- | ------------------ | ----- |
| Unit (camera)    | `npm run test:unit`     | 13 (TC-01–12 + property) |
| Component (RTL)  | `npm run test:component`| 16 (TC-13–16, 19, 20)    |
| E2E (Playwright) | `npm run test:e2e`      | 4 tests × chromium/firefox/webkit (TC-23–28, 31) |

E2E runs against `wrangler dev` (Cloudflare Workers runtime, port 8787) which
serves the Vite build from `dist/client`.

### Gotchas learned

- **Headless WebKit rAF starvation** — see above; the flush-fallback timer is
  why e2e drags pass on webkit.
- **Initial centering race** — the one-shot centre-on-first-measure happens in
  a ResizeObserver callback; e2e must settle on the centred view
  (`expectMarkerNear(640, 400)`) before calling the test hook, otherwise the
  centering overwrites the jump.
- **Button disable race** — the "Zoom in" button disables via an rAF commit;
  an e2e click loop between `isDisabled()` and `click()` can race it, so the
  loop uses `force: true` (a force-click on a disabled button is a no-op).

## Story 2: Capture ideas on sticky notes and rearrange them

### How it works

- **Model** (`src/shared/board-model.ts`, framework-free, real `Y.Doc`): one
  `meta` map (`schemaVersion: 1`) and one `objects` map keyed by id, each
  object a `Y.Map` with `type, x, y, color, text: Y.Text, z, createdAt`.
  Every successful mutation is exactly one `doc.transact(fn, LOCAL_ORIGIN)`;
  rejections (stale id, unknown colour, non-finite coordinates, bringToFront
  on the topmost) return `false` before opening a transaction — so a rejected
  call emits zero `update` events.
- **Reactivity** (`src/client/board/useBoardDoc.ts`): one `Y.Doc` per app, a
  single `objects.observeDeep` subscription bumping a version counter, and
  `useSyncExternalStore` with `snapshot()` (immutable, sorted by `z` then id,
  unknown types skipped). `text: Y.Text` is observed by the deep subscription,
  so typing re-renders only through the one subscription.
- **Sticky text** (`src/client/objects/StickyText.ts`): the editor commits on
  every input event via a minimal Y.Text diff (longest common prefix/suffix,
  surrogate-pair safe — no split code units ever enter the doc), so ending
  editing never writes an extra transaction. `clampToLimit` truncates at
  `STICKY_TEXT_MAX_CHARS` (1,000); the `n/1000` counter shows at ≥ 950 chars.
  Font auto-fit measures the text node and binary-searches the largest size
  in `[10, 24]` world px that fits the 176×176 px content box; overflow at
  the minimum size fades the bottom edge.
- **Note interaction** (`src/client/objects/StickyNote.tsx`): per-note state
  machine Unselected → Pressed → (Selected | Dragging); Editing is orthogonal.
  Selection/editing are local React state (App's `useSelection`), never stored
  in the doc. Drag starts only after `DRAG_THRESHOLD_PX` (3) of pointer travel
  (a short press stays a select); while dragging, `moveObject` writes are
  throttled to one per `requestAnimationFrame` and the note is brought to the
  front exactly once (drag start). `pointerup`/`pointercancel`/lost capture
  flush and release. Double-click starts editing (stopped from bubbling, so it
  never creates a note); Escape ends editing to Selected, blur ends to
  Unselected.
- **Keyboard** (window-level in `App`): Enter starts editing the selected
  note; Delete/Backspace delete it. Ignored while editing text (the textarea
  owns those keys) and when nothing is selected.
- **Toolbars**: the left toolbar (Sticky note button) and the floating note
  toolbar (six colour swatches + delete) are rendered in **screen space** by
  `App` (siblings of `BoardViewport`), not inside the world layer, so they
  are never scaled by zoom. The note toolbar anchors above the selected
  note's top edge and hides while dragging or editing.
- **Creating**: toolbar button → note centred on the viewport centre;
  double-click on empty board space → note centred on the clicked world point.
  Both start editing immediately. Note ids are `crypto.randomUUID()`.

### Test-mode hook

`window.__vidi6` (test-mode builds only) now also exposes board operations:
`createSticky(x, y, color?)`, `getStickyNotes()`, `moveSticky`, `deleteSticky`,
`bringStickyToFront`, `setStickyColor` — used by e2e to seed far-away notes
and assert model state.

### Test matrix

| Suite            | Command             | Count |
| ---------------- | ------------------- | ----- |
| Unit             | `npm run test:unit`     | 38 (camera, board model, sticky text) |
| Component (RTL)  | `npm run test:component`| 34 (navigation + sticky TC-18–29, 35–38) |
| E2E (Playwright) | `npm run test:e2e`      | 10 tests × chromium/firefox/webkit (TC-23–28, 30–34, 39 + navigation) |

### Gotchas learned

- **`-0` in e2e assertions** — `setCamera(0, 0, z)` compares the origin
  marker against `[-x*zoom, -y*zoom]`, which is `[-0, -0]`; `toEqual` treats
  `-0 ≠ 0`, so the helper normalizes with `+ 0`.
- **Initial-centring race (e2e)** — the one-shot viewport centre-on-first-
  measure clears any pending camera change, so `setCamera` in tests must wait
  for the marker to land on the viewport centre first (the helper does this).
- **Zoom floor** — `ZOOM_MIN` is 0.1 (not 0.2); from 100% it takes 11 ×1/1.25
  steps to reach it, and the zoom-out button disables at the floor (an e2e
  click loop must stop there).
- **Zoom steps anchor on the viewport centre** — a double-click at the screen
  centre maps to the same world point at any zoom; tests must not assume the
  camera stays at the origin after stepping.

## Runbook

```bash
npm install
npm run dev          # local Vite dev server
npm run dev:cf       # wrangler dev (Cloudflare runtime) on :8787
npm run typecheck
npm run test:unit
npm run test:component
npm run test:e2e     # builds a test-mode bundle, starts wrangler dev
npm run build        # production build (hooks excluded)
```

## Next story

Story 3 (multi-client sync) adds a Yjs provider (Durable Object relay) around
the same `board-model.ts` module; the client already treats the doc as the
single source of truth, so remote mutations should flow through the existing
`observeDeep` subscription without client changes. Selection/editing stay
local.
