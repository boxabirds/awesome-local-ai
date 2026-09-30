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
