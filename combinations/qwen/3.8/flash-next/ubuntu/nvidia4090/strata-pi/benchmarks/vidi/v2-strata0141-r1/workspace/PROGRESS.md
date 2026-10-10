# Story 9: Write free text anywhere on the board

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write text model unit tests first (TC-01 to TC-06) | done |
| 2 | Implement text object model and shared text-edit helpers | done |
| 3 | Write text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32) | done |
| 4 | Implement text layout and local-only box sync | done |
| 5 | Component tests: box sync writes only after local changes (TC-12, TC-13) | done |
| 6 | Implement tool mode with Select and Text tools and V/T/N/Escape shortcuts | done |
| 7 | Component tests for tool mode and Text tool (TC-14 to TC-18) | done |
| 8 | Implement TextObject, generalised TextEditor, TextToolbar and horizontal-only handles | done |
| 9 | Component tests for text objects: editing, empty removal, sizes, handles, remote delete, undo (TC-19 to TC-25) | done |
| 10 | E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Current position

**Story 9 done** - all ten tasks implemented and tested, committed as
`story 9: Write free text anywhere on the board`. TC-26's cross-browser half is blocked on this
machine: only Chromium is installed (`.e2e/browser.json`), which is recorded in NOTES.md.

## Task log

- **Task 1 done.** `TEXT_*` settings added to `src/shared/config.ts` named exactly as
  the design lists them (plus a `TextSize` union and `BoardTool` widened with
  `'text'`), stubs for `src/shared/objects/text.ts` and `src/shared/text-edit.ts`, and
  `tests/unit/text-model.test.ts` written first: TC-01 to TC-06 with the boundary
  cases (exactly 5000, 5001, unknown size key) and the "no `update` event" assertions.
- **Task 2 done.** `src/shared/objects/text.ts`: `createText` (top-left placement,
  `z = maxZ + 1`, initial box 40 x 26, one transaction, refuses a non-finite point),
  `setTextSize` (unknown key returns `false`), `setTextWidthFixed` (clamped to
  TEXT_MIN_WIDTH_WORLD, sets `widthMode: 'fixed'`), `setTextBox` (writes nothing when
  the box already matches), `isEmptyText` / `deleteIfEmpty` (zero characters only -
  whitespace stays - and deletes through `deleteObjects`), `textFrom` and
  `readTextSnapshot`; the module registers `'text'` as a selectable type and a snapshot
  reader with the board model, so selection, marquee, move and delete read text objects
  without any new interaction code. `src/shared/text-edit.ts`: `clampToLimit`,
  `minimalDiff` and the surrogate-safe `applyTextDiff`; `StickyText.ts` re-exports them
  with STICKY_TEXT_MAX_CHARS as its default limit and keeps only sticky-specific code
  (counter threshold, font fit, `applyTextDelta`). TC-01 to TC-06 pass.
- **Task 3 done.** `tests/unit/text-layout.test.ts`, written against the stub: TC-07 to
  TC-11 and the no-canvas error path TC-32, with a fake measurer (0.5 em per character)
  so wrapping is arithmetic, and the exact boundaries (a line measuring exactly 600,
  just under it, just over it).
- **Task 4 done.** `src/client/objects/textLayout.ts`: `Measurer` is a parameter rather
  than a hidden dependency, `createCanvasMeasurer` degrades to the named glyph estimate
  when no canvas exists, `layoutText` wraps greedily at word boundaries, caps automatic
  width at TEXT_MAX_AUTO_WIDTH_WORLD, uses a fixed width exactly with the
  TEXT_MIN_WIDTH_WORLD floor, and always answers `lines x size x TEXT_LINE_HEIGHT` for
  the height. A measurer that returns nonsense is replaced by the estimate instead of
  crashing.
- **Task 5 done.** `src/client/objects/useTextBoxSync.ts` (`remeasureTextBox`,
  `useMeasurer`, `useTextBoxSync`) plus `tests/component/TextBoxSync.test.tsx`: two real
  Y.Docs and a simulated peer prove a peer's typing produces **zero** box writes here, a
  local change produces exactly one with the measured box, a remeasure that changes
  nothing writes nothing, and the automatic -> fixed transition rewraps and writes the
  new height once.
- **Task 6 done.** `src/client/board/useTool.ts` exactly as the contract states
  (`useTool(canEdit)` -> `{ tool, setTool }`, and an active Text tool reverts to Select
  when `canEdit` goes false). `Toolbar` gained `Select (V)` and `Text (T)` buttons with
  `aria-pressed` and the sticky button became `Sticky note (N)` (its tooltip too). The
  shortcuts live in `useBoardKeys` - V, T, N and Escape, above the "nothing selected"
  rule so they work with an empty selection, behind the existing "typing is not a
  command" guard and `canEdit`. `BoardViewport` takes `tool` and `onTextClick`: while
  Text is held the cursor is `text` and the press is taken in the **capture** phase, so
  it neither pans nor marquees and a press on an existing object places text on top of
  it instead of selecting that object. `BoardView` wires them: the click calls
  `createText(doc, world, clientId)` in one undo step, puts the tool back to Select and
  starts editing the new object. `useClientId` is a small anonymous per-tab id used as
  `createdBy` until story 6 owns identity (story 6 replaces this one call).
- **Task 7 done.** `tests/component/Tool.test.tsx`: TC-14 (T/V/Escape and the pressed
  buttons), TC-15 (Text button disabled and T ignored on a board the room could not
  load, plus an active Text tool reverting to Select when the board is taken away),
  TC-16 (T while a note is being edited types the letter and leaves the tool alone),
  TC-17 (click at screen (300,200) creates a text object with its **top-left** at that
  world point, size M, automatic width, z above the notes, tool back to Select, selected
  and editing; a press that moves creates nothing), TC-18 (N still creates a sticky at
  the centre of the view). Harness helpers for tools and text objects added to
  `tests/component/harness.tsx`.
- **Task 8 done.** `src/client/objects/TextEditor.tsx` generalises story 2's editor
  (caret at end, Enter stays a newline, Escape/outside commits, minimal
  `applyTextDiff`, clamp, undo boundaries, Ctrl/Cmd+Z to the board's undo) and
  `StickyTextEditor.tsx` is now a thin wrapper over it with the sticky limits, classes
  and labels - story 2's tests are untouched. `TextObject.tsx` draws plain text at its
  stored box (`white-space: pre-wrap`, `TEXT_SIZES[size]`), edits on double-click,
  remeasures only after its own input and calls `deleteIfEmpty` when editing ends. A
  `TextToolbar` (`SelectionBar` for exactly one text) holds S/M/L/XL with `aria-pressed`
  and Delete; `setTextSize` + `remeasureTextBox` inside one undo boundary, x/y
  untouched. The registry gained `handles: 'all' | 'horizontal'` and `selectionHandlesMode`,
  `SelectionOverlay` renders only `e`/`w` for an all-horizontal selection, and
  `useTransformGesture` has a `resize-width` gesture: one text fixes its width and
  re-measures its height (dragging `w` keeps the right edge still), while a mixed
  selection keeps all eight handles and **moves** text proportionally - an automatic
  width stays content-derived, a fixed width scales and re-measures, and no handle ever
  changes a text size. `sharedMeasurer()` gives the whole board one canvas (or estimate)
  measurer instead of one per object.
- **Task 9 done.** `tests/component/TextObject.test.tsx` (21 cases): TC-19 caret at the
  end on re-entry, Enter not swallowed, a newline meaning two lines of height, the
  TEXT_MAX_CHARS clamp with `n/n` shown, Escape keeping the text selected, and a board
  the room could not loading giving no editor at all; TC-20 Escape with nothing typed -
  and with typed-then-deleted characters - removes the object and clears the selection,
  while three spaces are kept; TC-21 the four size buttons with M pressed, XL changing
  size and measured box but not x/y, and a size change while editing rewrapping;
  TC-22 only `e`/`w` handles, the right handle fixing width and growing height, the left
  handle keeping the right edge still; TC-23 all eight handles with a note selected, the
  text moving with the group at its own width and size, and a fixed width scaling and
  re-measuring; TC-24 a remote delete mid-sentence unmounting the editor with no error
  and no re-creation; TC-25 one Ctrl+Z taking text and stored box back together; plus
  concurrent typing into one `Y.Text` keeping every client's characters. jsdom has no
  canvas, so these run through the estimate measurer - which is why the expected boxes
  are computed with `layoutText(..., estimateTextWidth)` rather than hard-coded.

- **Task 10 done.** `tests/e2e/text.spec.ts` (7 cases, real Chromium, real fonts, the real
  sync server) with `tests/e2e/helpers/text.ts`: TC-26 the 300-character fixture typed through
  the Text tool stores `TEXT_MAX_AUTO_WIDTH_WORLD` and grows into several measured and
  *rendered* lines whose drawn box matches the stored one; TC-27 dragging the right handle
  fixes the width, rewraps the same words and grows the height, with `e`/`w` before and after
  and no `n`/`s` at any point; TC-28 a section title written above a cluster, made XL, dragged
  onto the cluster, deleted and brought back by one `Ctrl+Z` with its words, size and place;
  TC-29 two screens typing into one text ending with the same string holding both people's
  characters in order; TC-30 `MAX_CONCURRENT_EDITORS` screens each starting the Text tool at
  the same moment and every one of them drawing all the headings; TC-31 text started and left
  empty leaving no object, no editor and nothing for a marquee to select; plus a size changed
  under an open editor re-wrapping and undoing as one step. A `TEXT_ANNOTATION` fixture of
  exactly 300 characters was added to `tests/fixtures/texts.ts`, and the test-only hooks gained
  `texts()` and `createText(...)`.
- **Task 10 follow-up: the typing corruption found by TC-26, root-caused and fixed.** Under load
  TC-26 stored 300-character sentences with one character moved inside a word. `TextEditor` held
  the field's text in React state and passed it back as the textarea's `value`, and React
  re-asserts a controlled field after an input event with the value from the render about to be
  replaced: a keystroke landing before that render is applied to the text React put back. The field
  is now uncontrolled and `mirror` is the only writer of `el.value`, refusing to write when the
  field already holds the text and otherwise restoring the caret. An instrumented run proved it
  (the diff's base lagging the document while the field held neither) and ruled out the diff
  itself, a remount, a mid-burst server snapshot, keystroke batching and CPU throttling; jsdom
  cannot express the browser behaviour, so TC-26 is the guard, with a new component test covering
  what jsdom *can* express: a burst of raw browser-style input events dispatched without waiting
  for React. TC-29's precondition was changed from "both screens show the seed text" to "both
  screens have the object", because one person's typing arrives character by character and nothing
  the test asserts depends on how fast the seed lands. See NOTES.md for the whole account.

## Tests created so far

- `tests/unit/text-model.test.ts` - TC-01 to TC-06 (create and placement, size change,
  fixed width clamp, empty removal, no-op writes, invalid input), including TC-30's
  exact limits and the "transaction rejected without an `update` event" assertions.
- `tests/unit/text-layout.test.ts` - TC-07 to TC-11, TC-32.
- `tests/component/TextBoxSync.test.tsx` - TC-12, TC-13, the auto -> fixed transition.
- `tests/component/Tool.test.tsx` - TC-14 to TC-18.
- `tests/component/TextObject.test.tsx` - TC-19 to TC-25, plus the TEXT_MAX_CHARS clamp,
  the toolbar Delete, concurrent typing into one `Y.Text`, and a burst of keystrokes dispatched
  without waiting for React keeping every character in order.
- `tests/e2e/text.spec.ts` - TC-26 to TC-31 (and a size-while-editing case), chromium here,
  the config's browser projects covering firefox and webkit where a machine has them.
- Existing tests touched because the sticky button's accessible name gained "(N)":
  `tests/component/Toolbar.test.tsx` and `tests/e2e/helpers/sticky.ts`.

## Current state

- Task 1 to 10 of story 9 implemented and tested.
- `npm run typecheck` clean (app and worker configs).
- `npm run test:unit` and `npm run test:component`: 449 tests green (37 files).
- `npm run test:e2e`: 47 tests green in chromium, including the 7 story 9 cases; TC-26 is also
  green under `--workers=6 --repeat-each=5` (30 runs) after the editor fix. This machine has
  Chromium only, so TC-26's firefox/webkit half is blocked here and recorded in NOTES.md.
- Stories 6 and 13 to 17 remain out of scope for this run; `useClientId` is the placeholder
  story 6's identity replaces.
