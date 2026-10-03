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

Suite as left: `npm run build` ok, `npm run typecheck` ok (both tsconfigs), unit 193,
component 142, integration 56 (storage 12 of them), e2e 43 passing in chromium. TC-01 to
TC-36 are all covered; see NOTES.md ("What was tested where") for the layer map and the
two deviations worth knowing about before reading the tests.
