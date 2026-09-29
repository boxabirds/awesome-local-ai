# Implementation notes

Decisions made while implementing without anyone to ask.

## Story 1 — Pan and zoom around an infinite board

- **Where `useCamera` lives.** The design's `BoardViewport(props: { children })` contract has no camera props,
  yet the camera needs the viewport's measured size. `BoardViewport` therefore owns `useCamera` and renders
  `ZoomControls` and `NavigationHint` as overlay siblings of the input surface; `App.tsx` just mounts
  `<BoardViewport />`. Because the controls are siblings (not children) of the wheel-listening surface, a
  Ctrl-wheel over them never reaches the board and the browser default is not suppressed there (TC-30).
- **`useCamera` extras.** Besides the contract members it exposes `isPanning` (drives the grab/grabbing cursor
  and `data-state="idle|panning"`) and `zoomAt(point, factor)` (used by the Safari gesture handler).
- **Keyboard shortcuts** are handled on `window` (the whole page is the board) but ignored while typing in
  inputs/textareas/contenteditable, so later text-editing stories are unaffected. `+`/`_` and numpad keys are
  accepted as aliases of `=`/`-`.
- **Grid dots** are a CSS radial-gradient centred in each tile, so the background position is shifted by half a
  tile to keep dots on world multiples of `GRID_SPACING_WORLD`.
- **Initial view** is `resetCamera(viewport)` (100%, origin centred). Window resizes change only the viewport
  size; the camera's top-left anchor is unchanged.
- **Test hook.** `window.__vidi6.{setCamera,getCamera}` is installed only when `import.meta.env.MODE === 'test'`
  (verified absent from the production bundle). `npm run build` is the production build; e2e runs
  `npm run build:test` (same `dist/client` directory) and serves it with `wrangler dev`.
- **Red-phase commit skipped.** Task 1 asks for a separate commit of failing tests; the session rules ask for a
  single story commit, so the unit tests and implementation land together.
- **Firefox e2e.** In the build environment Firefox cannot start (`sandbox_init() failed: Operation not
  permitted`; `newPage` times out). Chromium and WebKit pass. `E2E_BROWSERS=chromium,webkit npm run test:e2e`
  selects a subset; the default still runs all three browsers.

## Story 2 — Capture ideas on sticky notes and rearrange them

- **Camera access for notes and toolbars.** `BoardViewport` still owns `useCamera` (story 1). It now takes
  optional props: `children` may be a render function `({ camera, viewport }) => …` (world layer), `overlay`
  renders screen-space content (the left `Toolbar`), and `onEmptyDoubleClick(world)` / `onEmptyClick()` report
  double-clicks and clicks (press + release under `DRAG_THRESHOLD_PX`) on empty board space. `App.tsx` wires
  these to the model and selection.
- **`createSticky` returns `string | false`.** The contract says `string`, but TC-39 requires rejecting
  non-finite coordinates with `false`. No-op mutations (move to the same spot, same colour) also return `false`
  without a transaction, as the contract's "false when rejected or a no-op" says. `StickyNote` therefore ends a
  drag only when the note no longer exists (`hasObject`), not on every `false`.
- **Stacking without DOM reordering.** Notes are rendered in creation order and stacked with CSS `z-index` equal
  to their rank in `(z, id)` order (`layer` prop on `StickyNote`). Moving the dragged node to the end of the DOM
  on `bringToFront` could drop pointer capture and focus mid-drag.
- **Note toolbar** is rendered by `StickyNote` as a world-layer sibling anchored at the note's top centre,
  counter-scaled by `1/zoom` (screen-sized) and above every note. It is hidden while dragging or editing.
- **Length limit on edits in the middle.** `clampToLimit` truncates (contract, TC-14–16). The editor uses
  `clampEdit(prev, next)`, which drops only the part of the *inserted* text that does not fit, so typing or
  pasting in the middle of a full note never cuts existing text at the end. Caret goes after the kept insert.
- **Selection details.** Keyboard focus (Tab) on a note selects it; a pointer press selects on release
  (Pressed → Selected). Escape ends editing and returns focus to the note so Enter/Delete keep working. Enter on
  a focused button is left to the button. A deleted note is dropped from the selection automatically.
- **Editing layout.** The textarea is sized to the measured text height so text stays vertically centred while
  editing; a hidden measuring element (same padding/width) drives `fitFontSize`. The fade is shown only when not
  editing (the textarea scrolls instead so the caret stays visible); the `is-overflowing` class is set either way.
- **Test hooks.** `window.__vidi6` is now assembled from parts: `useCamera` adds `setCamera/getCamera`,
  `useBoardDoc` adds `getNotes()` (test builds only). `App` accepts an optional `doc` for component tests.
- **Component tests with user-event** fake only `requestAnimationFrame` (Testing Library's async wrapper stalls
  when `setTimeout` is faked by Vitest).
- **Red-phase commits skipped** (tasks 1 and 3), as in story 1: one story commit.
- **Firefox e2e** still cannot start in this environment (sandbox error); all e2e pass in Chromium and WebKit.
