# Story 2: Capture ideas on sticky notes and rearrange them

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write board model unit tests first against a real Y.Doc (TC-01 to TC-12, TC-39) | done |
| 2 | Implement Yjs board model and useBoardDoc snapshot hook | done |
| 3 | Write sticky text logic unit tests first (TC-13 to TC-17) | done |
| 4 | Implement sticky text editing: start/end editing, minimal Y.Text diff, length limit, auto-fit font | done |
| 5 | Implement sticky note interaction: select, drag to move, double-click create, keyboard delete | done |
| 6 | Implement toolbars: Sticky note button, colour swatches and delete button | done |
| 7 | Component tests for sticky interaction, text editor and toolbars | done |
| 8 | E2E sticky note workflows (create, move at zoom, recolour, delete, long text) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## What the tests found

- **Dragging a lower note did nothing** (found by the e2e stacking test, TC-32). Notes were
  rendered in document drawing order, so bringing a note to the front moved its DOM element -
  and Chromium releases pointer capture when the captured element moves, which ended the drag
  on the same event that started it. Notes are now rendered in a stable order (creation order)
  and stacked with CSS `z-index: <z>`, so a `bringToFront` never touches the DOM.
- **The Sticky note button was behind the board** (found by e2e, TC-28/TC-34). The toolbar is
  page chrome rendered before the viewport, so the absolutely positioned viewport painted over
  it and swallowed the click. `.board-toolbar` now has `z-index: 2`.
- React 19 defers state updates scheduled outside `act()` to the scheduler queue, so component
  tests that read the DOM right after a dispatched event saw stale selection state. Every event
  helper in `tests/component/helpers.tsx` dispatches inside `act()`.
- A detached `Y.Text` cannot be read back (TC-13 as written was not a valid test): the case is
  tested as a `Y.Text` created detached and then attached to its `Y.Map`, which is what the
  model actually does.

## Skipped here

- `npm run test:e2e` runs 100 tests: 50 pass (chromium, chromium-retina), 50 are skipped because
  firefox and webkit cannot be launched on this machine (the launch probe in
  `tests/e2e/setup.ts` decides, as in story 1 - see NOTES.md).
