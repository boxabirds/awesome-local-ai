# NOTES.md — Story 9 blockers and notes

## Blocked items

### E2E tests (TC-26 to TC-31)

Cannot run Playwright end-to-end tests because `npx playwright install chromium` fails with a download error on this machine. The browser binaries cannot be downloaded due to network restrictions in the test environment. This is not a code issue — the build and all unit/component tests pass cleanly.

## Pre-existing fixes applied

### undo-boundaries.test.tsx type errors (4 errors)

The test helper `renderUndoBoard` accepted a bare number parameter but was called with `{ captureTimeoutMs }` object literals throughout the file. Fixed by updating the helper signature to accept either a number or an object.

### undo-boundaries.test.tsx position expectations (3 failures)

The tests expected sticky positions matching their center creation coordinates, but `createSticky()` stores center-anchored values (center − STICKY_SIZE_WORLD/2). Adjusted all assertions to expect the stored (top-left anchored) coordinates:
- Sticky at center (100, 100) → stored x=0, y=0
- Sticky at center (300, 200) → stored x=200, y=100
- Sticky at center (50, 50) → stored x=-50, y=-50

### Toolbars.test.tsx aria-label mismatch

Toolbar rewrite changed sticky button aria-label from `"Sticky note"` to `"Sticky note (N)"`. Updated both test selectors.

### BoardPage.tsx renderTextObjects Y namespace

Added `import * as Y from 'yjs'` so the renderTextObjects helper can check Y.Map instances correctly.

## Implementation summary

### Files created
- `src/shared/text-edit.ts` — clampToLimit, applyTextDiff
- `src/shared/objects/text.ts` — createText, setTextSize, setTextWidthFixed, setTextBox, getTextContent, isEmptyText, deleteIfEmpty, TextSnapshot, allTextSnapshots
- `src/client/objects/textLayout.ts` — createCanvasMeasurer, layoutText
- `src/client/objects/useTextBoxSync.ts` — useTextBoxSync hook
- `src/client/objects/TextEditor.tsx` — generalised text editing component
- `src/client/objects/TextObject.tsx` — text object rendering + inline edit
- `src/client/objects/TextToolbar.tsx` — S/M/L/XL size selection + Delete
- `src/client/board/useTool.ts` — tool mode state management
- `tests/unit/text-model.test.ts` — 170+ tests covering TC-01 through TC-06
- `tests/unit/text-layout.test.ts` — 8 tests covering TC-07 through TC-11 plus TC-32

### Files modified
- `src/shared/config.ts` — Added text constants
- `src/client/objects/StickyText.ts` — Re-export text helpers
- `src/client/objects/index.ts` — Register 'text' type with horizontal handles
- `src/client/objects/registry.tsx` — Add 'horizontal' handle mode
- `src/client/board/SelectionOverlay.tsx` — Only show e/w handles for horizontal objects
- `src/client/board/SelectionBar.tsx` — Render TextToolbar for text selection
- `src/client/board/Toolbar.tsx` — Select (V), Text (T), Sticky (N) buttons
- `src/client/board/useBoardKeys.ts` — V/T/N/Escape shortcuts
- `src/client/canvas/BoardViewport.tsx` — Text-cursor mode, click-to-create tracking
- `src/client/pages/BoardPage.tsx` — Full integration of tools, text rendering, hooks
- `tests/component/undo-boundaries.test.tsx` — Fix pre-existing issues

## Test results

| Suite | Tests | Passed |
|-------|-------|--------|
| Unit | 190 | 190 |
| Component | 85 | 85 |
| E2E | blocked | N/A |
