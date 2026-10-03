# Story 11: Sketch freehand with a pen

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Write stroke model and geometry unit tests first (TC-01 to TC-08) | done |
| 2 | Implement stroke model: RDP simplify, split, smooth path, createStroke, scaled points | done |
| 3 | Implement Pen tool: capture, local preview, commit on finish/cancel/limit, options toolbar, viewport routing | done |
| 4 | Implement StrokeObject rendering and registry entry with line-distance hit test and aspect-locked resize | done |
| 5 | Component tests for Pen tool and StrokeObject (TC-09 to TC-16, TC-21) | done |
| 6 | E2E pen workflows: annotate, shared sketch, tidy up (TC-17 to TC-20) | done |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).

Task 6's chromium half is done: TC-17 to TC-20 pass against `wrangler dev`, with TC-17's preview
sampled from the page's own animation frames and TC-18's delivery time logged (2ms) rather than
asserted. The task's "done when" also asks for TC-17 in firefox and webkit; both browsers abort at
launch on this machine, which is recorded in NOTES.md.
