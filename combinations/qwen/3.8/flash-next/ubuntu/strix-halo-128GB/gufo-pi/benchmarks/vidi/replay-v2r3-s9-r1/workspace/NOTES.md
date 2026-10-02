# Notes

## Story 8: Undo and redo my own changes without undoing anyone else's

### Decisions made

1. **`_manager` exposed on UndoController for test timing.** The `lib0/time` module
   captures `Date.now` at import time (`export const getUnixTime = Date.now`), so
   `vi.mock` and `vi.useFakeTimers()` cannot intercept it from within yjs. The
   capture-timeout unit tests (TC-12, TC-13) manipulate `manager.lastChange`
   directly to simulate elapsed time between transactions. This is a test-only
   property on the controller interface.

2. **Boundary calls surround every discrete model operation.** `useBoardKeys`
   (Delete, nudge), `App.tsx`/`BoardHarness` (createSticky, deleteObjects),
   `StickyNote` (setStickyColor, deleteObject), `useTransformGesture` (gesture
   start/end), and `StickyTextEditor` (edit start/end) all call
   `undoController.boundary()` to prevent unrelated changes from merging into
   a single undo step via the capture timeout.

3. **Test hook `addSticky` wraps in LOCAL_ORIGIN and boundary.** The text
   insertion inside `addSticky` now uses `doc.transact(..., LOCAL_ORIGIN)` so
   the text is part of the captured undo step.

4. **Keyboard undo handler placed before the editing/text-entry guard** in
   `useBoardKeys` so that undo/redo works when focus is on the board (note
   selected) but still skips when focus is in a text input/textarea.

5. **Ctrl/Cmd+Z in StickyTextEditor** intercepts the keydown, calls
   `undoController.undo()`/`redo()`, then syncs the textarea value from
   `ytext.toString()` so the native textarea undo history never diverges.

6. **No presence, offline, sign-in, dashboard, comments, export features.**
   Stories 6 and 13-17 are out of scope per the session instructions.

## Story 9: Write free text anywhere on the board

### Decisions made

1. **E2E server ports come from the environment.** `playwright.config.ts` and the
   two self-hosted specs now read `E2E_PORT`, `E2E_PERSIST_PORT` and
   `E2E_BROKEN_PORT` (defaults unchanged: 5173 / 5411 / 5412), and
   `tests/e2e/helpers/board.ts` exposes `E2E_BASE` + `createBoard()` so no spec
   hard-codes a port any more. This story's runs used 27952 / 27953 / 27954.

2. **The stored text box is a border box.** The rendered element has
   `TEXT_BOX_PADDING_WORLD` on both sides, so the text wraps at
   `width - 2 * TEXT_BOX_PADDING_WORLD`. `layoutText` therefore wraps at exactly
   the room the browser will give it. This shifts two boundary values from the
   design table: an auto box is the longest line *plus 2× padding*, and a line
   measuring exactly `TEXT_MAX_AUTO_WIDTH_WORLD` no longer fits in one line — it
   wraps and the box becomes exactly `TEXT_MAX_AUTO_WIDTH_WORLD`
   (`tests/unit/text-layout.test.ts` TC-07 to TC-09). The reason: if the stored
   box were narrower than the width the text was wrapped at, the browser would
   need more lines than the stored height and the text would be clipped.

3. **Auto width is a fixed point, not a shrink-wrap around wrapped lines.** In
   auto mode the box either hugs the longest logical line (+ padding) or, once
   that no longer fits, is exactly `TEXT_MAX_AUTO_WIDTH_WORLD`. Deriving the
   width from the *wrapped* lines would be self-inconsistent (wrap width 584 →
   box 466 → browser wraps at 450 → more lines than stored).

4. **A word wider than the content area counts as several visual lines.**
   `wrapLine` returns the wrapped lines and the visual line count
   (`ceil(wordWidth / available)`), matching `overflow-wrap: break-word`, so an
   unbreakable word still gets a tall enough box (TC-09, TC-10).

5. **The floating selection toolbar is not "outside" the editor.** The editor's
   outside-pointerdown listener runs in the capture phase, so a React
   `stopPropagation` on the toolbar buttons could not win: clicking a size button
   while typing ended the edit, unmounted the toolbar between pointerdown and
   mouseup, and the click never landed. Elements marked `data-editor-ui`
   (SelectionBar's bars) are now ignored by that listener, so the size toolbar
   works while the caret is still in the text, as the design requires
   ("the toolbar is still visible during editing").

6. **Text inside a mixed group resize is re-measured, not scaled.** In a
   selection that also holds sticky notes, dragging a corner repositions text
   objects proportionally and scales their width only when `widthMode` is
   `fixed`; the height is re-measured from the content and the font size never
   changes (story 7 behaviour for notes is untouched).

7. **Capture-timeout unit test made deterministic.** `tests/unit/undo-boundaries.test.ts`
   (story 8) subtracted from `manager.lastChange` *after* the first insert, which
   let real wall-clock time between the two inserts leak into the measured gap:
   under a loaded machine TC-13b split into two steps and failed. The helper now
   anchors `lastChange` immediately before the second insert
   (`lastChange = Date.now() - ms`), so the only residual error is the microseconds
   between two statements, and the "just inside the window" case uses 25 ms of
   slack instead of 1 ms.

8. **New test hooks:** `window.__vidi6.getTool()`, `setTool()` and
   `getEditingId()`. `getEditingId` is how the e2e tests learn which text object
   *their* client created — diffing the board is ambiguous when another
   participant creates text at the same moment (TC-29, TC-30).

9. **Measurer**: canvas 2d `measureText` with the Inter font stack, falling back
   to `length × fontPx × TEXT_GLYPH_WIDTH_RATIO` (0.52) when no canvas exists
   (node, jsdom, blocked API) so layout never throws (TC-32).

10. **No presence/cursor, offline, sign-in, dashboard, comments, export.** Out of
    scope for this story.
