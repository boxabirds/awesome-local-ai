# Story 9 — Write free text anywhere on the board

## Current status
- **done:** all tasks (1–10) complete; all unit/component/integration/e2e suites green
- **last commit:** (this commit)

## Tasks
- [x] 1. Text model + unit tests (TC-01–06)
- [x] 2. Text model implementation (createText, setTextSize, setTextWidthFixed, setTextBox, deleteIfEmpty)
- [x] 3. Text layout unit tests (TC-07–11, TC-32)
- [x] 4. Text layout implementation (layoutText, canvas measurer) + box sync (useTextBoxSync)
- [x] 5. Box sync component tests (TC-12, TC-13)
- [x] 6. Text tool UI + shortcuts (toolbar, V/T/N, click-to-create, load_failed)
- [x] 7. Tool component tests (TC-14–18)
- [x] 8. TextObject rendering, editor, TextToolbar, registry, handles, resize gesture
- [x] 9. Text object component tests (TC-19–25)
- [x] 10. e2e free text (TC-26–31)

## Decisions
- `src/shared/objects/text.ts` registers 'text' as a known object type on import (unit tests run without the client registry).
- Text stores explicit width/height (like stickies); box sync observes local Y.Text/size/width changes and writes setTextBox when the re-measured box differs.
- StickyTextEditor wraps a generalised TextEditor (per design); clampToLimit/applyTextDiff moved to src/shared/text-edit.ts with re-exports.
- Undo inverse transactions use the UndoManager as origin (not LOCAL_ORIGIN), so box-sync does not re-measure on undo — the stored box reverts exactly with the text (TC-25).
- `snapshotAll` is the all-types read used by text tests; `snapshot` remains sticky-only (unchanged).
- Test-only hook now exposes `size` and `widthMode` for text objects.

## Notes
- See NOTES.md.
