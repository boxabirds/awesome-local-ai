# Notes

## Story 1 — Pan and zoom around an infinite board

Decisions:
- `BoardViewport` has the contract props (`{ children }`), so it owns `useCamera` and renders `ZoomControls` and `NavigationHint` itself. `App.tsx` only mounts it (design text says App wires them; the contract signature wins).
- `useCamera` applies camera changes to a ref immediately and flushes React state once per animation frame. The hook also returns `isPanning`, `zoomAtPoint` (Safari gesture) and `setCamera` (test hook), in addition to the contract.
- Initial camera is `resetCamera(window size)`, so the starting point is centred on first load.
- Dot grid tiles are offset by half a tile so dots sit on world multiples of `GRID_SPACING_WORLD`.
- Task 1's red-phase commit was skipped; camera maths and its tests were written together and committed green.
- `window.__vidi6.setCamera` only exists in `--mode test` builds (`npm run build:test`); Playwright's web server builds that mode and serves it with `wrangler dev` on port 8799 (8787 was occupied on the dev machine).
- Component tests polyfill `PointerEvent` (jsdom lacks it).
- TC-07 and TC-33 are trivially/not applicable per the design.

E2E status: Chromium and WebKit pass. Firefox could not launch in the sandboxed build environment (macOS sandbox profile error), so it was not verified here. `VIDI_E2E_CHROMIUM_ONLY=1` restricts the run to Chromium.

## Story 2 — Capture ideas on sticky notes and rearrange them

Decisions:
- `createSticky` subtracts half the note size itself (callers pass the centre point, per task 1 and TC-01). It returns `string | false` (false for non-finite coordinates, per TC-39).
- `BoardViewport` takes `children` (node or render function with the camera), an `overlay` render prop for screen-space UI (the left toolbar), and `onEmptyDoubleClick` / `onEmptyClick` callbacks. `App.tsx` exports `BoardApp` (UI over a supplied doc) so component tests can reach the real Y.Doc.
- The note toolbar is rendered inside `StickyNote`, counter-scaled by 1/zoom so it stays a constant screen size.
- Note DOM order is stable (by id) and stacking uses `z-index` = `z`, so a drag that restacks never moves DOM nodes (which would drop pointer capture).
- Typing past the 1,000 limit drops the characters of the insertion that exceed it (`clampEdit`), not the tail of existing text. `clampToLimit` is the plain truncation from the contract.
- While editing, text is top-aligned in the textarea (display mode centres it vertically).
- `onSelect` accepts `string | null` so the bin button can clear selection. Tab-focus on a note plus Enter starts editing.
- Task 1/3 red-phase commits were skipped; tests were written alongside the implementation.

E2E status: Chromium passes (run with `VIDI_E2E_CHROMIUM_ONLY=1`); Firefox/WebKit not run for story 2 in this environment.
