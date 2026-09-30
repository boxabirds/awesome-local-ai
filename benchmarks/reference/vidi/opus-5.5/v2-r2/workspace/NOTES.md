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
