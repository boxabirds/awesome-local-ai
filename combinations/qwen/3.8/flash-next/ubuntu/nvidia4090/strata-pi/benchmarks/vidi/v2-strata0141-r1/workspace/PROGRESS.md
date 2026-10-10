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

## Results

- Unit: 353 tests pass, of which 17 are this story's (`tests/unit/stroke.test.ts`,
  TC-01 to TC-08 with their variants).
- Component: 250 tests pass, of which 26 are this story's
  (`tests/component/PenTool.test.tsx` 13, `tests/component/StrokeObject.test.tsx` 13 -
  TC-09 to TC-16 and TC-21).
- Integration: 60 tests pass, unchanged.
- E2E: 58 tests pass in Chromium - the 54 that were there, plus
  `tests/e2e/pen.spec.ts` (TC-17 to TC-20).
- `npm run typecheck`, `npm run build` and `npm run build:test` are clean.
- TC-17's Firefox and WebKit half stays **blocked** on this machine, for the reason at
  the top of NOTES.md (no Playwright browser binaries, only `@sparticuz/chromium`); the
  assertions are browser-neutral so the same test runs in all three wherever browsers
  exist. See NOTES.md, "Story 11".
