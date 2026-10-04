# NOTES

## Story 9 decisions

- **Empty text definition:** Only zero characters counts as empty (TC-04). Whitespace-only text is kept. This matches the design decision.
- **Text tool click on objects:** When the Text tool is active, objects have `pointerEvents: 'none'` so all clicks go to the viewport, which creates text at that point. This matches the PRD: "clicking on an existing object still creates text on top at that point."
- **N shortcut:** The N key creates a sticky note at the view centre, same as the story 2 Sticky note button. The button's aria-label was updated to "Sticky note (N)" per the design.
- **StickyTextEditor:** Kept as-is (not converted to a thin wrapper around TextEditor) to minimize risk to existing story 2 tests. The TextEditor is a separate generalised component used by TextObject. The shared logic (clampToLimit, applyTextDiff) is in `src/shared/text-edit.ts` and re-exported from `StickyText.ts`.
- **E2E TC-26 width assertion:** The exact width depends on font rendering in the browser. The test asserts width > 0 and <= 602 (within ±2 of the 600 max), which is sufficient to verify the wrapping behaviour.
- **Gap filled from story 3:** None needed. Story 3's sync behaviour (Y.Text concurrent editing, delete-while-editing) is already handled by the Yjs layer and the existing prune logic in useSelection.
