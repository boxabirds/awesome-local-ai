# Story 8: Undo and redo my own changes without undoing anyone else's

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 2 | Implement per-user undo history controller | done |
| 5 | E2E: recover my mistakes while colleagues work (TC-22 to TC-24) | done |
| 6 | Write undo history unit tests first with a simulated remote peer (TC-01 to TC-11) | done |
| 7 | Write capture-timeout unit tests first (TC-12, TC-13) | done |
| 8 | Wire undo step boundaries into transform gestures, toolbars and the text editor | done |
| 9 | Component tests: gesture and typing boundaries (TC-14 to TC-17) | done |
| 10 | Implement undo/redo shortcuts and toolbar buttons | done |
| 11 | Component tests: undo shortcuts, buttons and edit lock (TC-18 to TC-21) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

Note: tasks are executed in dependency order (6, 7 test-first → 2 → 8 → 9 → 10 → 11 → 5),
because tasks 6/7 are "write tests first" and task 2's "Done when" requires the tests of
task 6 to exist; e2e (5) needs the full wiring.
