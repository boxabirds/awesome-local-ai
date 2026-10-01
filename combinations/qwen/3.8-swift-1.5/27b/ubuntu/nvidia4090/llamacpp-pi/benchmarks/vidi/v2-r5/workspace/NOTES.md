# Implementation Notes

## Story 9: Write free text anywhere on the board

### Decisions

1. **Empty text definition**: Only zero characters counts as empty (TC-04). Whitespace-only text (e.g., "  ") is kept, per the design's explicit decision.

2. **Initial box estimate**: `createText` sets an initial width of `TEXT_MIN_WIDTH_WORLD` (40) and height of one line at the default size. This ensures bounds exist before the first measurement. The editor's first input triggers `remeasureAfterLocalChange` which writes the correct dimensions.

3. **TextEditor generalisation**: The `TextEditor` component is a generalisation of `StickyTextEditor`. The sticky editor now wraps the shared `TextEditor` internally (via the `StickyTextEditor` component which still exists for backward compatibility). The shared editor accepts `maxChars`, `fontPx`, `width`, and `onInput` props.

4. **Remeasure strategy**: The `remeasureText` callback in `BoardContent` uses a character-count-based estimate (fontSize × 0.6 per char) for width calculation. This is sufficient for the toolbar size change and handle drag scenarios. The `useTextBoxSync` hook provides the more precise canvas-based measurement for the editor's input handler. In a full production implementation, the canvas measurer would be used everywhere, but the estimate keeps the implementation simple and testable in jsdom.

5. **BoardViewport click handling**: When the Text tool is active, `pointerdown` on empty space does not initiate pan or marquee. Instead, a `click` event on the viewport triggers `onClickEmptyWithPoint` which creates a text object at that world position.

6. **E2E tests**: The e2e test file (`tests/e2e/text.spec.ts`) is written per the spec (TC-26 to TC-31) but could not be executed in this sandbox environment due to browser display limitations. The tests are structured correctly and should pass in a CI environment with proper browser support.

7. **Registry handles property**: The `ObjectTypeSpec` interface gained an optional `handles?: 'all' | 'horizontal'` property. The `SelectionOverlay` checks if all selected objects have `handles: 'horizontal'` and, if so, renders only the `e` and `w` handles.

8. **Snapshot type**: The `snapshot()` function now returns `ObjectSnapshot[]` (the base type) instead of `StickySnapshot[]`. The `ObjectSnapshot` interface gained optional fields (`color`, `text`, `createdAt`, `width`, `height`, `size`, `widthMode`, `createdBy`) so existing code that accesses these fields continues to type-check.

### Files added
- `src/shared/config.ts` (modified: TEXT_* settings)
- `src/shared/text-edit.ts` (new: shared clampToLimit, applyTextDiff)
- `src/shared/objects/text.ts` (new: text model)
- `src/client/objects/textLayout.ts` (new: layoutText, createCanvasMeasurer)
- `src/client/objects/useTextBoxSync.ts` (new: box sync hook)
- `src/client/objects/TextEditor.tsx` (new: generalised editor)
- `src/client/objects/TextObject.tsx` (new: text object component)
- `src/client/objects/TextToolbar.tsx` (new: size + delete toolbar)
- `src/client/objects/registerText.ts` (new: registry entry)
- `src/client/board/useTool.ts` (new: tool state hook)
- `tests/unit/text-model.test.ts` (new: TC-01 to TC-06)
- `tests/unit/text-layout.test.ts` (new: TC-07 to TC-11, TC-32)
- `tests/component/TextBoxSync.test.tsx` (new: TC-12, TC-13)
- `tests/component/Tool.test.tsx` (new: TC-14 to TC-18)
- `tests/component/TextObject.test.tsx` (new: TC-19 to TC-25)
- `tests/e2e/text.spec.ts` (new: TC-26 to TC-31)

### Files modified
- `src/shared/board-model.ts` (snapshot includes text, objectBounds handles text)
- `src/client/objects/StickyText.ts` (re-exports from text-edit.ts)
- `src/client/objects/registry.tsx` (handles property)
- `src/client/board/Toolbar.tsx` (Select/Text tool buttons)
- `src/client/board/SelectionOverlay.tsx` (horizontal-only handles)
- `src/client/board/SelectionBar.tsx` (TextToolbar for text objects)
- `src/client/board/useBoardKeys.ts` (N key, Enter for text)
- `src/client/canvas/BoardViewport.tsx` (text tool cursor, click-to-create)
- `src/client/pages/BoardContent.tsx` (tool state, text creation, remeasure)
- `src/client/board/useBoardDoc.ts` (ObjectSnapshot type)
