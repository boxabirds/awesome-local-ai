# Story 8: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 8 is built and committed as `9b054f9`. Build, typecheck and every test script pass on the final runs. Some earlier runs had failures, covered under Results.

## What I built
- **`src/client/board/undo.ts`**: `createUndo(doc, opts)` wraps a `Y.UndoManager` over the `objects` map. It only records this tab's own changes (`LOCAL_ORIGIN`), so changes from other people or from loading a saved board never enter the history. It keeps at most `UNDO_MAX_STEPS` steps, and a new change of your own clears redo. It also has `addScope` (for story 16), `onChange` and `destroy`.
- **`src/client/board/useUndo.ts`**: `useUndo(controller, canEdit)`, plus `useUndoController(doc)`, which gives one controller per board document and throws it away on unmount (history doesn't survive a reload). It also defines `UndoContext`.
- **`src/client/board/UndoButtons.tsx`**: Undo and Redo buttons in the left toolbar, below Sticky note. Tooltips are "Undo (Ctrl/Cmd+Z)" and "Redo (Ctrl/Cmd+Shift+Z)". The buttons are disabled when there's nothing to undo or redo, or when the board failed to load.
- **Where one step starts and ends:**
  - A whole drag or resize is one step, including a cancelled one.
  - Note creation, a colour change, a delete and each arrow-key nudge are one step each.
  - Starting and stopping text editing close the current step.
- **Shortcuts:**
  - On the board, Ctrl/Cmd+Z undoes, and Ctrl/Cmd+Shift+Z or Ctrl+Y redoes, without the browser's own undo.
  - They are ignored in text fields such as the share link, and while the board failed to load.
  - Inside the note editor, the same keys undo and redo only the typing done during that edit.
- **Settings**: `UNDO_CAPTURE_TIMEOUT_MS = 500` and `UNDO_MAX_STEPS = 200` in `src/shared/config.ts`.
- **Tests**: unit TC-01–TC-13 (`tests/unit/undo-history.test.ts`, `tests/unit/undo-boundaries.test.ts`, helper `tests/unit/helpers/peer.ts`), component TC-14–TC-21 (`tests/component/UndoBoundaries.test.tsx`, `tests/component/UndoControls.test.tsx`), e2e TC-22–TC-24 (`tests/e2e/undo.spec.ts`), and a new 12-note fixture `undoRetroBoard()` in `tests/fixtures/boards.ts`.

## Results (final runs)
| Script | Result |
|---|---|
| `npm run build` | passes |
| `npm run typecheck` | passes, no errors |
| `npm run test:unit` | 166/166 passed (14 files) |
| `npm run test:component` | 150/150 passed (13 files) |
| `npm run test:integration` | 61/61 passed (5 files) |
| `npm run test:e2e` (`E2E_BROWSERS=chromium,firefox`, `E2E_PORT=8877`) | 72 passed, 3 skipped (the Chromium-only multi-window tests, in Firefox) |
| `npm run test:e2e:nightly` | TC-29 passed; TC-30 failed on the first run, passed twice after |

Earlier failures:
- **Firefox, story 3 tests TC-24 and TC-26:** failed in one full e2e run and in one of two repeat runs of their file. Every other run passed, with and without story 8, including with story 8's code stashed.
- **Nightly TC-30:** the first run had one delivery at 1,173 ms, over the 1 s budget, while TC-29 ran alongside it. Run alone it passed twice, with a worst delivery of 800 and 697 ms. Without story 8 the worst was 690 ms.

I read both as the load problems already recorded in the story 4/5 notes, not a regression. But both first showed up on runs with the new code.

## Left undone
- TC-24 only runs in Chromium. Firefox doesn't deliver input to several windows at once, the same limit as story 7's TC-36.
- WebKit still can't start on the build machine.
- Not covered, as the design says: object types from stories 9–12, comments, and IME input combined with the typing pause.

## Decisions in NOTES.md
- **Controller lives in `Board.tsx`, not `App.tsx`.** Since story 5, `Board` owns the board document. It's created in an effect so React StrictMode ends up with exactly one controller. `Board` also takes an optional `createUndoController` prop so tests can pass a fake.
- **Extra controller methods:**
  - `beginGesture()`/`endGesture()`: only calling `boundary` at the start and end of a drag would split it into two steps if the pointer is held still for 0.5 s.
  - `lastStep()`: lets the note editor know where the current edit started.
  - An exported shortcut matcher, `undoKey(event)`, shared by the board keys and the editor.
- **The controller measures the 500 ms pause itself.** Yjs reads the clock in a way test fake clocks can't control, so the exact 499 ms / 500 ms boundary couldn't be tested otherwise. Behaviour is the same.
- **One press undoes exactly one step.** Yjs normally skips a step that has no effect, such as moving a note someone else has since deleted, and undoes the one below it in the same press. The PRD says nothing visible should happen, so the controller stops after one step.
- **Undo inside the note editor** stops at where the edit started, so it can't undo the note's own creation or an earlier move. Redo in the editor only re-applies typing undone in that edit. It always blocks the browser's own text undo, except during IME composition.
- **Cmd+Y is not redo**, because it's the browser's history shortcut on macOS. Alt combinations are ignored. While the board failed to load, the shortcuts are ignored and the browser's default is left alone.
- **Other people's changes don't clear your redo**; only your own new changes do.
- **Memory:** when a step falls off the 200-step history, Yjs gives no public way to release its data. It stays in that tab's memory until reload; the server's copy is unaffected.
- **Test-first:** unit TC-01–13 failed against a "not implemented" stub before I implemented anything. The component tests were checked by breaking the code on purpose: two specific changes made them fail.
- **Flaky runs:** the Firefox and nightly failures above, with the numbers from the re-runs.
