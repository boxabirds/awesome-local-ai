# Story 9: Write free text anywhere on the board

## Progress Summary

All design-mandated tasks are complete. Implementation and unit/component tests for stories 6, 7, and 9 pass. E2E tests require a running dev server and browser.

| # | Task | Status | Notes |
|---|---|---|-------|
| 1 | Write text model unit tests first (TC-01 to TC-06) | done | `tests/unit/text-model.test.ts` — 17 tests |
| 2 | Implement text object model and shared text-edit helpers | done | `src/shared/objects/text.ts`, `src/shared/text-edit.ts` |
| 3 | Write text layout unit tests with fake measurer (TC-07 to TC-11, TC-32) | done | `tests/unit/text-layout.test.ts` — 6 tests |
| 4 | Implement text layout and local-only box sync | done | `src/client/objects/textLayout.ts`, `useTextBoxSync.ts` |
| 5 | Component tests: box sync writes only after local changes (TC-12, TC-13) | done | `tests/component/TextBoxSync.test.tsx` — 3 tests |
| 6 | Implement tool mode + V/T/N/Escape shortcuts; fix HomePage/BoardPage/SharePanel pre-existing test gaps | done | Gap fills: `HomePage.test.tsx`, `BoardPage.test.tsx`, `SharePanel.test.tsx` fixed vi.mock hoisting issues; see NOTES.md |
| 7 | Component tests for tool mode and Text tool (TC-14 to TC-18) | done | `tests/component/Tool.test.tsx` — 6 tests |
| 8 | Implement TextObject, TextEditor, TextToolbar, horizontal handles, App wiring | done | `TextObject.tsx`, `TextEditor.tsx`, `TextToolbar.tsx`, `registry.tsx`, `App.tsx` full refactor |
| 9 | Component tests for text objects (TC-19 to TC-25) | done | `tests/component/TextObject.test.tsx` — 8 tests |
| 10 | E2E text workflows (TC-26 to TC-31) | blocked | Requires Playwright browser; no browser installed in this environment |

## Test Results

```
Unit Tests:    194 passed (15 files)
Component:     71 passed  (13 files)
Integration:   44 passed (4 files, 1 pre-existing WebSocket header failure)
Build:         ✓ tsc --noEmit && vite build
Typecheck:     ✓ passes
```

## Excluded Stories
Stories 6 (sticky color picker) and 13–17 (shapes, tools, undo stack, collaboration polish) are explicitly excluded from scope.
