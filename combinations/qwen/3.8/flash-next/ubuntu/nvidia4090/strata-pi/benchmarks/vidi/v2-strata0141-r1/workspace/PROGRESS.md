# Story 8: Undo and redo my own changes without undoing anyone else's

Your progress on this story's tasks. Keep the Status column up to date as you work.

Working order: the test-first tasks (6, 7) run before the implementation task (2)
they are written against, so each suite is seen failing before the code that
makes it pass. Tasks 8/9 (boundaries) and 10/11 (controls) pair a wiring change
with its tests; the e2e task (5) comes last, once the product exists.

| # | Task | Status |
|---|---|---|
| 6 | Write undo history unit tests first with a simulated remote peer (TC-01 to TC-11) | done |
| 7 | Write capture-timeout unit tests first (TC-12, TC-13) | done |
| 2 | Implement per-user undo history controller | done |
| 8 | Wire undo step boundaries into transform gestures, toolbars and the text editor | done |
| 9 | Component tests: gesture and typing boundaries (TC-14 to TC-17) | done |
| 10 | Implement undo/redo shortcuts and toolbar buttons | done |
| 11 | Component tests: undo shortcuts, buttons and edit lock (TC-18 to TC-21) | done |
| 5 | E2E: recover my mistakes while colleagues work (TC-22 to TC-24) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).
