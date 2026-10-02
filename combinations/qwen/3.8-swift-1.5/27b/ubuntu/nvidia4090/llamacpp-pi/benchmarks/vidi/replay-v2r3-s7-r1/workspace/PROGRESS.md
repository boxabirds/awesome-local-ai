# Story 7: Select, move, resize and delete several objects at once

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 2 | Implement geometry and generic group operations in board-model | done |
| 5 | E2E: colleague deletes one of my selected notes (TC-35) | done |
| 6 | Write geometry and group-operation unit tests first (TC-01 to TC-10) | done |
| 7 | Write registry unit tests first (TC-11, TC-12, duplicate registration) | done |
| 8 | Implement object type registry and register sticky notes | done |
| 9 | Write selection reducer unit tests first (TC-13 to TC-15) | done |
| 10 | Implement multi-selection state, outlines and selection bar | done |
| 11 | Implement Shift+drag marquee selection | done |
| 12 | Implement generic transform gesture: group move and bounding-box resize handles | done |
| 13 | Implement selection keyboard commands: select all, clear, nudge, delete | done |
| 14 | Component tests: selection bar, marquee, transform gesture and keyboard (TC-16 to TC-31) | done |
| 15 | E2E: reorganise a cluster and full-capacity reorganisation (TC-32, TC-33, TC-34, TC-36) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

## Notes

- All test suites pass: typecheck clean, 124 unit, 72 component, 27 integration, 72 e2e.
- E2E runs on chromium + firefox. The webkit (Safari) project is omitted in
  `playwright.config.ts` because its host dependency (`libavif`) cannot be
  installed in this sandbox (no root / no-new-privileges). The app code is
  browser-agnostic; webkit is not a code limitation.
- Two real bugs found and fixed via E2E (both invisible to unit/component tests):
  1. A focus change on mousedown made Chromium fire a spurious `pointercancel`
     mid-drag, killing in-progress move/resize. Fixed by `preventDefault()` on
     the note's pointerdown (StickyNote).
  2. Resize handles were positioned with world coordinates while nested inside
     the (already world-placed) selection box, double-offsetting them off-screen
     for any non-origin box. Fixed with box-relative offsets (SelectionOverlay).
- The document previously had zero layout height (all content `position:fixed`),
  which made Chromium hit-testing of trusted pointer events unreliable. Added
  `global.css` giving `html/body/#root` a full-viewport layout.
