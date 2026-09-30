# Story 2 — Capture ideas on sticky notes and rearrange them

## Summary

Added sticky notes to the vidi6 whiteboard. A note is a fixed-size (200×200
world units) square that holds a `Y.Text`, can be selected, dragged, recoloured
(6 colours), edited (double-click / Enter), and deleted (bin button /
Delete / Backspace). Creation happens via the left "Sticky note" toolbar button
(note centred on the visible board area) or by double-clicking empty board
space (note centred on the click point). After creation the note is selected
and immediately in editing mode with the caret at the end.

## Architecture / decisions

- **Shared Yjs board model** (`src/shared/board-model.ts`): the single source
  of truth. `objects` is a `Y.Map` of object maps; each sticky is
  `{ type, x, y, color, text: Y.Text, createdAt }`. All mutations go through
  pure functions (`createSticky`, `moveObject`, `bringToFront`,
  `setStickyColor`, `deleteObject`) so unit tests can drive the model without
  React. `snapshot()` produces plain `StickySnapshot[]` for rendering.
- **`useBoardDoc`** (`src/client/board/useBoardDoc.ts`): creates one `Y.Doc`
  per app instance (stored in a `useRef` so HMR/remounts keep it), subscribes
  with `doc.observeDeep` and exposes a fresh `notes` snapshot via
  `useSyncExternalStore`. The doc is exposed on `window.__vidi6.doc` for tests.
- **`useSelection`** (`src/client/board/useSelection.ts`): `selectedId` /
  `editingId` state machine. `startEdit` clears `selectedId` (a note is either
  selected *or* being edited, not both), `endEdit` returns to selected when the
  note still exists.
- **Text editing** (`StickyTextEditor.tsx`): a `<textarea>` bound to `Y.Text`.
  On `input` it computes a **minimal diff** (`applyTextDiff`) — longest common
  prefix/suffix — and applies a single `retained+inserted/deleted` update to
  `Y.Text`, so the cursor position is preserved and we never rewrite the whole
  string. IME composition is handled by deferring writes to `compositionend`.
  `clampToLimit` enforces `STICKY_TEXT_MAX_CHARS` (1000) in code points
  (surrogate-pair safe) and restores the caret to the end when truncated.
- **Font auto-fit** (`fitFontSize` in `StickyText.ts`): binary search for the
  largest font in `[STICKY_FONT_MIN_PX, STICKY_FONT_MAX_PX]` whose rendered
  text fits the note's content box. Uses `canvas.measureText` for width and a
  line-height estimate for height; no layout thrash.
- **Dragging** (`StickyNote.tsx`): pointer events on the note element.
  `DRAG_THRESHOLD_PX` (3) distinguishes a click (select) from a drag. Once the
  threshold is crossed the note is brought to front and position updates are
  throttled with `requestAnimationFrame` (at most one `moveObject` per frame).
  `pointercancel` ends the drag at the last applied position. The note stops
  propagation so the viewport never pans while dragging a note.
- **Keyboard**: `Enter` on a selected note enters editing; `Delete`/`Backspace`
  delete the selected note. Both are ignored while editing (the textarea owns
  the keys) or when focus is in any input/textarea/contenteditable.
- **Double-click** on empty board space creates a note centred on the click
  point; double-click on a note edits that note (no new note). The viewport
  distinguishes the two by checking the event target (container/grid vs note).
- **Stable DOM order + CSS `zIndex` for stacking**: notes render in a stable
  order (by id) and their stacking is expressed with `zIndex = z`. If the DOM
  order followed z, `bringToFront` *during a drag* would re-insert the note's
  element, and Chromium releases pointer capture on re-insertion — the
  `lostpointercapture` handler would then silently kill the drag after one
  step. Stable order keeps the captured element in place for the whole drag.
- **Font fit uses an off-screen probe**: the note's text div has a fixed
  height (`inset: 0`), so its own `scrollHeight` is always ≥ that height and
  cannot detect overflow. `fitFontSize` measures a hidden `height: auto` probe
  with the same width/font/wrapping instead.
- **Note toolbar** (`NoteToolbar.tsx`): colour swatches (with `aria-pressed`)
  and a delete button, shown only when the note is selected. It is
  counter-scaled (`scale(1/zoom)`) so it stays a constant screen size.
- **Counter-scaled text**: note content scales with the camera zoom (it lives
  in world space); only the toolbar is counter-scaled.
- **Selection cleared when a note disappears**: an effect watches the snapshot
  and clears `selectedId`/`editingId` if the referenced note no longer exists
  (e.g. deleted mid-interaction), which also silently ends drag/edit state.

## Testing

- **Unit** (`tests/unit/board-model.test.ts`, `tests/unit/sticky-text.ts`):
  model functions, diff/clamp/fit logic. `Y.Text` must be doc-bound in tests.
- **Component** (`tests/component/Sticky*.tsx`, `Toolbars.tsx`): render the
  real `<App />` in jsdom, drive it with synthetic pointer/keyboard events,
  and assert on the DOM + `window.__vidi6.doc` snapshot. `tests/setup.ts`
  polyfills `ResizeObserver` (jsdom lacks it) so `App` boots.
- **E2E** (`tests/e2e/sticky-notes.spec.ts`): Playwright + chromium against the
  built app served by `wrangler dev`; uses the `setCamera` helper to place the
  camera deterministically.
- `tests/fixtures/texts.ts` holds shared strings (e.g. an exact 50-char string).

## Notes / gotchas

- **Build before E2E**: the Playwright `webServer` is `wrangler dev`, which
  serves the static `dist/client` output — it does **not** run Vite. E2E tests
  therefore run against the last `npm run build`. Always rebuild before
  `npm run test:e2e`, or the tests exercise stale code.
- **E2E note identification**: the DOM order (by id) differs from the
  snapshot order (by z), so e2e tests must never index `snapshot()` by DOM
  index. Notes are identified by mapping their world position to the screen
  (`noteScreenCenter`) and matching against the click point.
- At high zoom a double-click that lands on an existing note edits that note
  (no new note) — e2e test geometry must keep creation click points off
  existing notes.
- The Yjs `YMap` generic is required by TS (`Y.Map<unknown>`); `objects()`
  casts accordingly. `snapshot()` casts `color` back to `StickyColor`.
- `Y.Text.observe` events carry a delta of `{retain, insert, delete}`; the
  counter/font-fit recompute on every change via the doc subscription.
- `applyTextDiff` uses code-point arrays (`[...str]`) for prefix/suffix so
  emoji/surrogate pairs are counted and clamped correctly.
