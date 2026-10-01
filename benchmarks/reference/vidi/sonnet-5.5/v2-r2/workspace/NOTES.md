# Notes

## Story 1 decisions

- `BoardViewport` takes a `controller` (the `useCamera` result) and an `onResize` prop in addition to `children`, so `App.tsx` can share the camera with `ZoomControls` and `NavigationHint`. The design's contract lists only `children`, but it also says controls are wired to `useCamera` in `App.tsx`.
- `useCamera` keeps the latest camera in a ref, so several events in one frame compose, and flushes React state once per `requestAnimationFrame`. The UI therefore lags an event by up to one frame, and the e2e tests poll for that.
- Initial camera is `resetCamera(window size)`, so the origin starts centred. The viewport size is then tracked by a `ResizeObserver`; resizing never changes camera x/y.
- `useCamera` also exposes `zoomAtPoint` (Safari pinch) and `setCamera` (test hook only).
- Keyboard shortcuts (Ctrl/Cmd + `=`/`+`/`-`/`0`) are bound on `window`; the app has no other focusable inputs yet, so "board focused" is treated as always.
- The dot grid is a CSS radial-gradient with the dot at the tile centre; the background offset is computed modulo the world spacing, so it stays exact at 1,000,000 units.
- `test:e2e` builds with `--mode test` (which enables `window.__vidi6`) and then runs Playwright against `wrangler dev`. `npm run build` produces the production bundle without the hook.
- Only Chromium is installed in this environment, so the Firefox and WebKit e2e projects are configured but were not run. WebKit/Firefox pixel behaviour is unverified here.
- Hint, ZoomControls and wheel-over-controls tests (TC-22, TC-30, TC-32 and others) run in jsdom.
- TC-07 is trivial because the camera module has no viewport-size input. The design's contract has no resize function, so the test just asserts an existing camera object is not touched.
- The red-phase commit for task 1 was skipped; tests and implementation were committed together in one commit.

## Story 2 decisions

- `createSticky` takes the note **centre** and subtracts half the size itself (as the board-model contract says); callers pass the click or viewport-centre world point. Non-finite points return `""`.
- `App` accepts an optional `doc` prop (tests seed a real `Y.Doc`); `useBoardDoc` adopts it.
- Notes render in a stable DOM order (createdAt, id) and stack with `z-index` from the `(z, id)` order. Re-ordering DOM nodes during `bringToFront` dropped pointer capture mid-drag. `StickyNote` has an extra optional `stackIndex` prop for this.
- `StickyNote` renders its own `NoteToolbar` (scaled by 1/zoom so it keeps screen size). A removed note clears the selection via an effect in `App`.
- A note also becomes selected when it receives keyboard focus (Tab). Editing a note keeps a hidden measuring copy of the text, so font fit and vertical centring work in edit mode.
- `StickyTextEditor` takes an extra optional `padTop` prop to keep typed text vertically centred like displayed text.
- Empty-board click is detected on pointerup (< `DRAG_THRESHOLD_PX` movement) in `BoardViewport`, via new `onBoardClick` / `onBoardDoubleClick` props.
- The story 1 navigation hint is unchanged: it hides only after the user navigates, not when notes exist.
- Only Chromium e2e was run; Firefox/WebKit are not installed here.
