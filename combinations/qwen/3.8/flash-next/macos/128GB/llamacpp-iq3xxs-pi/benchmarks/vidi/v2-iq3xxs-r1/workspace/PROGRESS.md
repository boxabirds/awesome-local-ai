# Story 9 — Progress log

## Status

Task titles and numbers are taken from `spec/stories/009-write-free-text-anywhere-on-the-board/tasks.md`.

| # | Task | Status |
| - | ---- | ------ |
| 1 | Write text model unit tests first (TC-01 to TC-06) | done |
| 2 | Implement text object model and shared text-edit helpers | done |
| 3 | Write text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32) | done |
| 4 | Implement text layout and local-only box sync | done |
| 5 | Component tests: box sync writes only after local changes (TC-12, TC-13) | done |
| 6 | Implement tool mode with Select and Text tools and V/T/N/Escape shortcuts | done |
| 7 | Component tests for tool mode and Text tool (TC-14 to TC-18) | done |
| 8 | Implement TextObject, generalised TextEditor, TextToolbar and horizontal-only handles | done |
| 9 | Component tests for text objects (TC-19 to TC-25) | done |
| 10 | E2E text workflows (TC-26 to TC-31) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Task 1: Write text model unit tests first (TC-01 to TC-06) — done

Read the story 9 spec (prd, design, tasks), then studied the existing code:
- `src/shared/board-model.ts` (schema, LOCAL_ORIGIN, snapshot, group ops)
- `src/client/objects/*` (StickyText, StickyTextEditor, StickyNote, registry)
- `src/client/board/*` (Board, useSelection, SelectionOverlay, useTransformGesture, useBoardKeys, undo/useUndo, Toolbar, SelectionBar)
- `src/client/canvas/BoardViewport.tsx`, camera, testHooks
- test conventions: `tests/component/util.ts`, `stickyUtil.ts`, e2e helpers, playwright config (ports 25232/25233).

Created:
- `src/shared/config.ts`: added TEXT_* named settings (max auto width 600, min width 40,
  5000 chars, TEXT_SIZES S/M/L/XL, DEFAULT_TEXT_SIZE M, TEXT_LINE_HEIGHT 1.3,
  TEXT_FONT_FAMILY, average glyph width ratio for the no-canvas estimate).
- `src/shared/objects/text.ts`: stub with the design's contract (TextSnapshot + helpers),
  every function throws `not implemented`.
- `src/shared/text-edit.ts`: stub for clampToLimit/applyTextDiff.
- `tests/unit/text-model.test.ts`: TC-01..TC-06 + stale-id/negative + compatibility +
  concurrent-merge tests.

Verified: `npx vitest run --project unit tests/unit/text-model.test.ts` → 10 failed with
"not implemented" (test-first, as the task requires). `npx tsc --noEmit` clean.

## Task 2: Implement text object model and shared text-edit helpers — done

- `src/shared/text-edit.ts`: moved `clampToLimit`, `applyTextDiff` (and `applyRemoteDelta`
  + its types, so the shared editor can use it) out of `StickyText.ts`.
- `src/client/objects/StickyText.ts`: now re-exports those (sticky wrappers keep the
  1,000-character default and the LOCAL_ORIGIN default), and keeps the sticky-only
  `counterVisible` + font fitting. `tests/unit/sticky-text.test.ts` (which asserts
  `board-model`'s re-exported helpers are the same objects) passes unchanged.
- `src/shared/objects/text.ts`: implemented `createText` (top-left point, M, auto width,
  empty `Y.Text`, z above every object, initial estimate box), `setTextSize`,
  `setTextWidthFixed` (clamps to 40, switches to fixed), `setTextBox`, `getTextContent`,
  `isEmptyText`, `deleteIfEmpty`, `textSnapshots` (paint order `(z, id)`).
  Every setter refuses stale ids, foreign object types (a sticky note is not a text
  object), and non-finite numbers without opening a transaction; `setTextSize` and
  `setTextBox` also write nothing when the value would not change.

Verified: `npx vitest run --project unit` → 16 files, 185 tests passed.
`npx tsc --noEmit` clean.

## Task 3: Text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32) — done

`tests/unit/text-layout.test.ts` (node project, as tasks.md asks): TC-07 measured width and
one line at M; TC-08 past the limit → width TEXT_MAX_AUTO_WIDTH_WORLD + greedy word wrap +
character breaking for a lone over-long word; TC-09 the exact 600 boundary (600 → one line,
601 → two); TC-10 fixed width at the TEXT_MIN_WIDTH_WORLD boundary → one word per line,
height 3 lines (and below the boundary the width is clamped up to it); TC-11 explicit
newlines → width = longest line, height = lines × size × TEXT_LINE_HEIGHT, plus the realistic
`RETRO_ITEM` fixture at S and XL; TC-32 `createCanvasMeasurer` in an environment with no
`OffscreenCanvas`, no `document`, no canvas → the estimate, and no throw. Plus: every size
preset drives the height, and stored boxes are rounded to two decimals so peers agree.
Determinism comes from the injected fake measurer (half the font size per character), so all
expected boxes are written-out numbers.

File naming: the design's test-plan table lists `tests/component/TextLayout.test.tsx` for
TC-07 to TC-13, while tasks.md task 3 is a `test:unit` task. Both are satisfied by splitting
them the way the tasks ask — layout cases (pure, no DOM) in the unit project, box-sync
cases (two `Y.Doc`s plus a rendered hook) in `tests/component/TextBoxSync.test.tsx`.

Note on ordering: tasks 3 and 4 were worked on together in one sitting — `textLayout.ts` and
`useTextBoxSync.ts` existed before this file was run against them, so task 3 was not
strictly test-first for the layout (unlike task 1, which was). Everything above passes
against the real implementation, and nothing here was written to fit a known-green build.

## Task 4: Implement text layout and local-only box sync — done

- `src/client/objects/textLayout.ts`: `Measurer`, `estimateMeasurer` (named average glyph
  width ratio), `createCanvasMeasurer(TEXT_FONT_FAMILY)` (canvas 2D metrics, cache of short
  lines only, bounded, falls back to the estimate where there is no canvas), and
  `layoutText(text, size, mode, fixedWidth, measure)` → `{ width, height, lines }`.
  auto: width = min(longest measured line, TEXT_MAX_AUTO_WIDTH_WORLD), greedy word wrap
  past it (characters for a lone over-long word); fixed: width = max(fixedWidth,
  TEXT_MIN_WIDTH_WORLD); height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT, always.
- `src/client/objects/useTextBoxSync.ts`: `remeasureTextBox(doc, id, measure)` (pure, also
  used by the transform gesture) and `useTextBoxSync(doc, id, measure)` →
  `remeasureAfterLocalChange()`, which is only ever called after a change made by *this*
  client. No writes come from a remote update.

## Task 5: Component tests for box sync (TC-12, TC-13) — done

`tests/component/TextBoxSync.test.tsx`, with two real `Y.Doc`s (local + simulated peer) and
the fake measurer:
- TC-12 remote peer types (five times) → zero local box writes; one local change → exactly
  one transaction whose only touched keys are `width`/`height`, with the measured numbers,
  which the peer then renders rather than measuring itself.
- TC-13 re-measuring an unchanged box writes nothing (fresh object, explicit box, after a
  size change that did not need a new box); a size change that does need one writes once.
- Auto → fixed transition after a width drag: widthMode fixed, the dragged width kept, the
  height rewritten exactly once, and re-measuring afterwards says nothing more.
- Stale id → no write; `snapshot()` still holds only sticky notes (compatibility).
- Writes are counted with `observeDeep` on the objects map filtered by
  `tr.origin === LOCAL_ORIGIN`, which is the exact meaning of "no local transaction".

Verified: `npx vitest run --project unit --project component` → 31 files, 284 tests passed;
`npx tsc --noEmit` clean.

## Task 6: Tool mode, V/T/N/Escape — done

- `src/client/board/useTool.ts` (new): `Tool = 'select' | 'text'`, per tab and per board, in
  React state only — never in the shared document, so two people are never in each other's
  mode (PRD text.tool).
- `src/client/board/useBoardKeys.ts`: plain-key guard before V/T/N; `V` and `T` switch tools
  (ignored when the board cannot be edited or when a text field owns the keystroke); `N` now
  runs the same action as the Sticky note button (double-click unchanged); `Escape` leaves
  the Text tool as well as ending editing.
- `src/client/board/Toolbar.tsx`: Select and Text buttons with `aria-pressed`, both disabled
  when `canEdit` is false; the Sticky note button is labelled `Sticky note (N)` and its
  tooltip keeps the double-click hint (existing test updated to the new label).
- `src/client/canvas/BoardViewport.tsx`: holds the tool, shows a caret cursor and
  `data-tool` while Text is active, and takes the Text-tool clicks in the capture phase on
  the viewport itself, stopping pan, marquee and double-click-a-note while Text is active.
  A click on an existing object still creates text on top of it (design "Errors").
- `Board.tsx`: `objects` = notes and texts in z order; text creation at a screen point
  (`createTextAtScreenPoint`) wrapped in one undo boundary pair, so a create-then-type-then
  leave is undoable as expected; test hook gained `getTexts`/`seedTexts`.

## Task 7: Component tests for the tool (TC-14 to TC-18) — done

`tests/component/TextTool.test.tsx` (+ `tests/component/textUtil.ts` for the shared text
fixtures and queries):
- TC-14 T → Text (button `aria-pressed`, viewport `data-tool="text"` and a caret cursor),
  Escape and V back to Select.
- TC-15 load-failure board: the Text button is disabled and T does nothing (negative).
- TC-16 `t` typed while editing a note goes into the note (`Retrot`), tool stays Select.
- TC-17 Text-tool click at (300,200) creates a text whose top-left is `screenToWorld` of
  that point, size M, widthMode auto, empty; the editor is open for it and the tool is back
  to Select.
- TC-18 `N` still creates a sticky at the centre of the view and starts editing it.

## Task 8: TextObject, TextEditor, TextToolbar, horizontal handles — done

- `src/client/objects/TextEditor.tsx` (new, from `StickyTextEditor`): the shared editor for
  any board object — `width: number | 'auto' | 'fill'`, `onInput` hook (this is where a text
  object re-measures its box), `renderStatus` (the sticky note's character counter),
  composition-safe, one undo step per editing session, and Ctrl/Cmd+Z taken away from the
  textarea's own history so it cannot disagree with the shared text. `StickyTextEditor` is
  now a thin wrapper over it (`width="fill"`), so story 2 behaviour is unchanged.
- `src/client/objects/TextObject.tsx` (new): paints `x/y/width/height` from the document and
  never from the DOM; selects on press and hands moving/resizing to the generic gesture;
  double-click edits with the caret at the end; ends editing on Escape (keeps selection) or a
  pointerdown outside (drops it); an empty text is removed when the edit ends — while typing
  it is kept, so the caret has somewhere to be; `deleteIfEmpty` writes in the same local
  transaction as the last keystroke.
- `src/client/board/TextToolbar.tsx` (new): four size buttons (labels `Small (S)` … `Extra
  large (XL)`, current one `aria-pressed` and inert) and `Delete text`. Like a note's
  toolbar it is anchored to its object and scaled by 1/zoom, so it stays a constant size on
  screen — the design named the component but not its mount point; `SelectionBar` is left to
  the objects that need colour tools.
- `src/client/objects/registry.tsx` + `SelectionOverlay.tsx`: `handles?: 'all' | 'horizontal'`
  in the object spec (sticky notes keep everything); a selection made only of horizontal
  objects gets `e`/`w`, and one sticky note anywhere in the selection brings all eight back
  (PRD text.consistent).
- `useTransformGesture.ts`: an east/west drag on a text sets `widthMode: 'fixed'` and the
  dragged width, then re-measures the height in the same transaction; a west-handle drag
  also moves `x`, so the right edge stays put. A mixed selection still resizes everything
  else freely.
- `src/client/index.css`: pressed tool button, `.text-object`, `.board-text-content`,
  `.board-text-input` (same font, line height and box as the display so text does not jump
  when it becomes editable) and the text toolbar.

## Task 9: Component tests for text objects (TC-19 to TC-25) — done

`tests/component/TextObject.test.tsx` — boxes are asserted against `layoutText` with the
exported `estimateMeasurer` (jsdom has no canvas, so the documented fallback is what runs);
no numbers were typed in:
- TC-19 double-click opens the editor with the caret at the end, nothing selected, and the
  object stays the selected one.
- TC-20 an empty text goes when editing ends by Escape or by a click elsewhere; while typing,
  an emptied text survives (the caret needs a home) and goes the moment the edit ends.
- TC-21 toolbar shows the four sizes with the current one pressed; clicking XL keeps `x`/`y`
  and the text, and gives the box a bigger size implies; while editing there are no size
  buttons at all.
- TC-22 one selected text → `e` and `w` only, and the selection box is the object's box.
- TC-23 rubber band over a text and a note → all eight handles.
- TC-24 a remote delete while editing closes the editor, removes the object and clears the
  selection without a crash.
- TC-25 Ctrl+Z inside the editor takes the typing and its box back as one step.

Two harness notes, both worth keeping in mind for later stories:
- `tests/component/util.ts`: `dispatchPointer` now carries `shiftKey`, which is how a rubber
  band starts.
- RTL's teardown can leave the previous test's board mounted until the scheduler runs, so two
  boards share the page and the test hook can belong to the older one. Tests that await
  inside `act` now mount with `freshBoard()` (a flushed frame before and after `render`) so
  the fixture, the hook and the DOM all belong to one board.

## Task 10: E2E text workflows (TC-26 to TC-31) — done

`tests/e2e/text.spec.ts` (+ `tests/e2e/helpers/text.ts`), run against the real server with
real fonts, on chromium:
- TC-26 the Text tool, a 400-character annotation, and a box that stops growing sideways:
  width within 2 of `TEXT_MAX_AUTO_WIDTH_WORLD`, several rendered lines, and the box the
  document holds equals the box the browser painted to within one pixel (`clientWidth`/
  `clientHeight` against the snapshot).
- TC-27 east-handle drag: `widthMode` becomes `fixed`, the width lands within 6 of the
  dragged width, the height grows past one line, `x`/`y` stay put, and `n`/`s`/corner handles
  are asserted *absent* (`toHaveCount(0)`).
- TC-28 golden path: heading typed, XL from the toolbar with the top-left unchanged, moved by
  dragging the text itself, deleted, and brought back by Ctrl+Z with its size, width, text and
  position.
- TC-29 two screens typing into one text: five interleaved pairs of keystrokes, then wait for
  the two screens to agree and compare the *sorted characters* — Yjs promises every character
  survives, not a particular order.
- TC-30 `MAX_CONCURRENT_EDITORS` screens on one board each press T, click and type at once;
  every screen ends up seeing all the headings, with distinct ids.
- TC-31 Escape with nothing typed leaves no object and no element; a shift-drag rubber band
  over that spot selects nothing.

One real bug came out of running this in a browser rather than in jsdom: the automatic width
was rounded to two decimals in the usual way, which can round *down*, and the browser then
wrapped at a box slightly narrower than the line it holds — a single sentence painted on two
lines. `layoutText` now rounds an automatic width up instead (`ceil`), so a box is never
shorter than its own line; fixed widths are still taken exactly as dragged. jsdom could not
see this because its measurer is a character-count estimate that lands on round numbers.

## Verification (story 9, this machine)

- `npx vitest run --project unit --project component` → 33 files, 296 tests passed (run four
  times in a row after the last fix; the one intermittent failure, a story 8 redo assertion
  that read the board before React had committed it, now waits with `flushUntil`).
- `npm run test:integration` → 5 files, 60 tests passed.
- `npx playwright test --project=chromium` → 44 tests passed, including the six new text
  workflows. This machine cannot launch Firefox or WebKit (recorded above and in
  `playwright.config.ts`), so the design's "TC-26 also in firefox and webkit" stays
  un-run here rather than faked.
- `npx tsc --noEmit` clean.
- E2E serves `dist/client`, and the running server is reused between runs, so a client
  change needs the server on port 25232 killed before the next `playwright test` — otherwise
  the suite silently tests the previous build.
