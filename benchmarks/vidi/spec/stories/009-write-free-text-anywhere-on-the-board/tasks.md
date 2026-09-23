# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write text model unit tests first (TC-01 to TC-06) | proposed | test:unit | text.model |
| 2 | Implement text object model and shared text-edit helpers | proposed | implementation | text.model |
| 3 | Write text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32) | proposed | test:unit | text.layout |
| 4 | Implement text layout and local-only box sync | proposed | implementation | text.layout |
| 5 | Component tests: box sync writes only after local changes (TC-12, TC-13) | proposed | test:ui-component | text.layout |
| 6 | Implement tool mode with Select and Text tools and V/T/N/Escape shortcuts | proposed | implementation | text.tool_ui |
| 7 | Component tests for tool mode and Text tool (TC-14 to TC-18) | proposed | test:ui-component | text.tool_ui |
| 8 | Implement TextObject, generalised TextEditor, TextToolbar and horizontal-only handles | proposed | implementation | text.object |
| 9 | Component tests for text objects: editing, empty removal, sizes, handles, remote delete, undo (TC-19 to TC-25) | proposed | test:ui-component | text.object |
| 10 | E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31) | proposed | test:e2e | text.object, text.tool_ui |

## Details

### 1. Write text model unit tests first (TC-01 to TC-06)

## Goal
Test-first suite for the text.model contract against a real Y.Doc; add TEXT_* settings and stub `text.ts` exports.

## Cases
- TC-01 `createText(doc,{100,50},'g_test')` → type 'text', size DEFAULT_TEXT_SIZE, widthMode 'auto', empty Y.Text, z above existing objects, createdBy 'g_test'.
- TC-02 `setTextSize` XL applied; 'XXL' → false and no update event (error path).
- TC-03 `setTextWidthFixed(id, 30)` → width TEXT_MIN_WIDTH_WORLD, widthMode 'fixed' (boundary).
- TC-04 `isEmptyText` true for zero characters → `deleteIfEmpty` removes; whitespace-only text is kept (negative).
- TC-05 `clampToLimit` with TEXT_MAX_CHARS: 5,001 → 5,000; 4,999 + 1 accepted (boundaries).
- TC-06 non-finite create point → null, no transaction (error path).
- Stale id for every setter → false, no update.

## Done when
Compiles and fails with "not implemented"; committed.

### 2. Implement text object model and shared text-edit helpers

## Goal
Implement text.model per contract.

## Approach
- Schema: `type 'text', x, y, width, height, z, createdAt, createdBy, text: Y.Text, size: TextSize, widthMode`.
- `createText` (LOCAL_ORIGIN, z = max + 1, initial box from an estimate so bounds exist before first measure), `setTextSize` (reject unknown keys), `setTextWidthFixed` (clamp TEXT_MIN_WIDTH_WORLD, widthMode fixed), `setTextBox`, `getTextContent`, `isEmptyText` (zero characters only), `deleteIfEmpty` (via story 7 `deleteObjects`).
- All setters reject stale ids and non-finite numbers without a transaction.
- Move `clampToLimit(next, max)` and `applyTextDiff` into `src/shared/text-edit.ts`; `StickyText.ts` re-exports with STICKY_TEXT_MAX_CHARS so story 2 callers and tests are unchanged.
- No text-specific selection/move/delete code — those stay generic (text.consistent).

## Done when
Text model unit tests and story 2 sticky-text tests pass.

### 3. Write text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32)

## Goal
Test-first coverage of text.layout's pure `layoutText` and `createCanvasMeasurer` fallback, using a deterministic fake measurer (fixed world units per character at each TEXT_SIZES value).

## Cases
- TC-07 'Went well' at M in auto mode → width = measured line + padding, height one line (TEXT_SIZES.M × TEXT_LINE_HEIGHT).
- TC-08 line measuring 900 → width TEXT_MAX_AUTO_WIDTH_WORLD, greedy word wrap into 2 lines, height 2 lines.
- TC-09 line measuring exactly 600 → one line, width 600 (boundary).
- TC-10 fixed width TEXT_MIN_WIDTH_WORLD with three words → one word per line, height 3 lines (boundary).
- TC-11 text with explicit newlines → width = longest line, height = line count × size × TEXT_LINE_HEIGHT.
- TC-32 `createCanvasMeasurer` in an environment without canvas → estimate fallback, no throw (error path).

## Done when
Fails against stubs; committed.

### 4. Implement text layout and local-only box sync

## Goal
Implement text.layout per contract.

## Approach
- `createCanvasMeasurer(TEXT_FONT_FAMILY)`: OffscreenCanvas/canvas `measureText` at the given px; if unavailable, estimate with a named average glyph width ratio constant.
- `layoutText(text, size, mode, fixedWidth, measure)`: split on newlines; auto mode width = min(longest measured line, TEXT_MAX_AUTO_WIDTH_WORLD) and greedy word-wrap lines exceeding it; fixed mode wraps at fixedWidth; height = lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT (height always follows content, text.height).
- `useTextBoxSync(doc, id, measure)`: `remeasureAfterLocalChange()` computes the box and calls `setTextBox` only if it differs; it is invoked only by local typing, size changes and fixed-width drags — never on remote updates — so five clients never race to write dimensions.

## Done when
TC-07 to TC-13 and TC-32 pass.

### 5. Component tests: box sync writes only after local changes (TC-12, TC-13)

## Goal
Verify useTextBoxSync's local-only write rule with two real Y.Docs (local + simulated remote peer) and a fake measurer.

## Cases
- TC-12 remote peer changes the text → local client performs zero `setTextBox` writes; a local text change → exactly one write with the measured width/height.
- TC-13 local size change whose remeasured box equals the stored box → no write (negative: no redundant updates).
- Auto → fixed transition after a width drag rewraps and writes new height once.

## Done when
All pass in `npm run test:component`.

### 6. Implement tool mode with Select and Text tools and V/T/N/Escape shortcuts

## Goal
Implement text.tool_ui per contract.

## Approach
- `useTool(canEdit)`: `tool: 'select' | 'text'`, `setTool`; when `canEdit` turns false an active Text tool reverts to Select.
- Shortcuts in `useBoardKeys` (ignored while editing text or focus in inputs): V → select, T → text (only if canEdit), Escape → select, N → story 2 create-sticky-at-centre.
- Toolbar: `button[aria-label="Select (V)"]`, `button[aria-label="Text (T)"]` with `aria-pressed`; Text disabled when `!canEdit`.
- `BoardViewport`: while Text active, cursor `text`, empty-space pointerdown neither pans nor starts a marquee; click (also on top of objects) → `createText(screenToWorld(point), identity.id)`, `setTool('select')`, select and start editing the new id.

## Done when
TC-14 to TC-18 pass.

### 7. Component tests for tool mode and Text tool (TC-14 to TC-18)

## Goal
jsdom tests for text.tool_ui (`useTool`, Toolbar tool buttons, BoardViewport click-to-create).

## Cases
- TC-14 T → Text active and button `aria-pressed=true`; Escape → Select; T then V → Select.
- TC-15 canEdit false → T ignored, Text button disabled (negative).
- TC-16 T pressed while editing a sticky → character typed, tool unchanged (negative).
- TC-17 Text active, click board at screen (300,200) → `createText` at `screenToWorld` point, tool back to Select, editor mounted for the new id.
- TC-18 N still creates a sticky at the view centre (regression of story 2 behaviour).

## Done when
All pass.

### 8. Implement TextObject, generalised TextEditor, TextToolbar and horizontal-only handles

## Goal
Implement text.object per contract.

## Approach
- `TextEditor`: generalise story 2's editor (maxChars, fontPx, width) — caret at end on mount, Enter newline, Escape/outside click → onEnd, minimal `applyTextDiff`, clamp TEXT_MAX_CHARS, undo boundaries on start/end, Ctrl/Cmd+Z routed to the undo controller; `StickyTextEditor` wraps it.
- `TextObject`: plain text, no fill, at x/y with stored width/height, `white-space: pre-wrap`, font TEXT_SIZES[size]; dblclick or Enter (single selection, canEdit) starts editing; input calls `remeasureAfterLocalChange`; edit end calls `deleteIfEmpty` (empty removed, selection cleared); remote deletion during editing ends silently.
- `TextToolbar` in `SelectionBar` for exactly one text: S/M/L/XL with `aria-pressed` → `setTextSize` + remeasure (x/y unchanged); Delete.
- Registry: add optional `handles: 'all' | 'horizontal'`; register text {resizable, not aspect-locked, minSize TEXT_MIN_WIDTH_WORLD, editableText, handles 'horizontal'}.
- `SelectionOverlay` shows only e/w handles when all selected specs are horizontal; single-text horizontal drag → `setTextWidthFixed` + remeasure. Mixed selections: text repositioned proportionally, fixed widths scale, font size unchanged.
- Concurrent typing merges through Y.Text diffs.

## Done when
TC-19 to TC-31 pass.

### 9. Component tests for text objects: editing, empty removal, sizes, handles, remote delete, undo (TC-19 to TC-25)

## Goal
jsdom tests for text.object with a real Y.Doc, real undo controller and fake measurer.

## Cases
- TC-19 editor caret at end; Enter inserts newline; Escape ends editing and keeps text selected.
- TC-20 Escape with zero characters → object removed, selection cleared (negative: no invisible text).
- TC-21 TextToolbar shows S/M/L/XL with M pressed; click XL → size XL, x/y unchanged.
- TC-22 single text selected → only e and w handles rendered.
- TC-23 text + sticky selected → all handles; resize repositions text proportionally, font size unchanged.
- TC-24 remote delete while editing → editor unmounts, no error, object not recreated (error path).
- TC-25 type then Ctrl+Z → text and stored box revert together in one step.

## Done when
All pass.

### 10. E2E text workflows: headings, long annotations, abandoned text, concurrent editing (TC-26 to TC-31)

## Goal
Real-browser proof of the Text tool (text.tool_ui) and text objects (text.object) with real fonts and the real sync server.

## Workflows
- TC-26 "Long annotation": press T, click, type the 300-character fixture → stored width TEXT_MAX_AUTO_WIDTH_WORLD ±2, several rendered lines.
- TC-27 drag the right handle narrower → words rewrap, height grows, no top/bottom handles present.
- TC-28 "Title a retro section": T, click above a cluster, type "Went well", Escape, click XL, drag over cluster, Delete, Ctrl/Cmd+Z restores it.
- TC-29 two contexts type into the same text simultaneously → identical text containing every character.
- TC-30 MAX_CONCURRENT_EDITORS contexts each create a heading at once via the Text tool → all headings visible on every screen.
- TC-31 "Abandoned text": T, click, Escape without typing → no text object in the doc; Shift+drag over the spot selects nothing.

## Done when
All pass in chromium; TC-26 also in firefox and webkit (wrapping differences within ±2 units).

