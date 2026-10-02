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

### What could not be done on this machine

**Firefox and WebKit cannot be launched, so TC-26's cross-browser leg runs in
chromium only here.** The browser binaries *are* installed
(`~/.cache/ms-playwright/firefox-1543`, `webkit-2359`) but they do not start:

- firefox: `ldd` on `libxul.so` reports `libgtk-3.so.0`, `libgdk-3.so.0`,
  `libmozgtk.so`, `libmozwayland.so` and `libmozsqlite3.so` missing, and the
  system `libnss3.so` does not provide the `NSS_3.126` symbol version it needs.
- webkit: `pw_run` reports `libwebp.so.7`, `libwebpmux.so.3`,
  `libwebpdemux.so.2`, `libavif.so.16`, `libharfbuzz-icu.so.0`, `libepoxy.so.0`,
  `libjpeg.so.8`, `libwayland-server.so.0`, `libmanette-0.2.so.0`,
  `libenchant-2.so.2`, `libhyphen.so.0`, `libGLESv2.so.2` and `libx264.so`
  missing.

Fixing this needs `npx playwright install-deps`, i.e. root. This session runs as
uid 1000 with the `no new privileges` flag set (`sudo` refuses to escalate) and
`apt-get` has no package lists, so no system package can be installed.

Therefore the `firefox` and `webkit` Playwright projects are present in
`playwright.config.ts` as commented-out lines. `tests/e2e/text.spec.ts` uses no
chromium-only API in the TC-26 tests, so uncommenting those two lines on a
machine with the libraries runs the annotation and heading workflows in all
three engines, as the design asks. Everything else in the story is fully tested
and green here: 200 unit tests, 113 component tests, 46 integration tests and
the whole end-to-end suite in chromium.

### Decisions made

1. **`TextToolbar` is anchored inside `TextObject`, not in `SelectionBar`.**
   `SelectionBar` is the multi-select bar ("N selected" + Delete) and only
   appears for two or more objects; the size buttons belong to one text, exactly
   like `NoteToolbar` belongs to one `StickyNote`.

2. **The Text tool click is handled in the capture phase on the viewport root**
   (`handlePointerDownCapture` / `handlePointerUpCapture` in `BoardViewport`) and
   calls `stopPropagation()`. A click in Text mode must never select, start a
   marquee on or drag an object it lands on. The second click of a rapid
   double-click is suppressed for 600 ms (`textClickAtRef`) so placing text does
   not also drop a sticky note on top of it.

3. **`TextEditor` is the single editor; `StickyTextEditor` is a thin wrapper.**
   Everything story 2 needs (1,000-character clamp, surrogate safety, live
   counter, auto-fit, Enter as newline, Escape/blur to end, one undo boundary at
   each end of an edit) lives in `TextEditor` and is configured through props
   (`maxChars`, `fontPx`, `width`, `autoFit`, `counter`, `containerSelector`).
   Text objects pass `maxChars = TEXT_MAX_CHARS` (5,000), no counter and no
   auto-fit.

4. **The editor mirrors remote changes into its textarea.** On any transaction
   whose origin is not `LOCAL_ORIGIN`, the textarea value is replaced by the
   `Y.Text` and the caret keeps its distance from the end. Without this, the
   next `applyTextDiff` would be computed against a stale value and would delete
   what the other person had just typed — TC-29 covers it.

5. **Only local changes are measured.** `useTextBoxSync` writes the box after
   transactions with origin `LOCAL_ORIGIN` that touch anything but `width` /
   `height`, so a remote typist never triggers a second measurement and a
   measurement never triggers another write. Consequence worth knowing: an object
   created *and* filled before its React component has mounted is not measured by
   the hook; in the app the Text-tool click measures explicitly
   (`writeTextBox` in `App.handleTextToolClick`) and typing always happens after
   mount.

6. **`snapshotObjects()` was added beside `snapshot()`.** `snapshot()` returns
   sticky notes only and about twenty existing test files depend on that, so
   story 9 adds the union view instead of changing the old one.

7. **No import cycle between `board-model` and `objects/text`.** `text.ts`
   imports values from `board-model.ts`; `board-model.ts` imports the text types
   with `import type`, which disappears at compile time.

8. **Handles follow the objects, not the selection size.** `handlesFor(types)`
   returns `'horizontal'` only when every selected object is horizontal-only
   (`handles: 'horizontal'` in the registry), otherwise all eight. Dragging a
   sideways handle of a text fixes its width and re-measures; in a mixed group
   resize an automatic text keeps its width, a fixed one scales with the group,
   and every text's height is remeasured for the new scale.

9. **`undo-boundaries.test.ts` TC-13b is timing-sensitive and occasionally
   fails** on a loaded machine (capture-timeout test with real timers). It is
   pre-existing, unrelated to story 9, and passes on a re-run.
