# Story 7 — Select / move / resize / delete several objects at once · test suite

This directory documents the tests that exercise Story 7. It is a *catalogue*,
not runnable code: the runnable tests live beside the code they cover
(`tests/unit`, `tests/component`, `tests/e2e`). Read `tc-cases.md` (or
`tc-cases.json`) for the TC-id → file → status map; read the rest for how to run
the suite and for the two areas that did **not** converge.

## Layers (match `vitest.config.ts` + `playwright.config.ts`)

| Layer | Where | Runner |
|-------|-------|--------|
| `test:unit` | `tests/unit/**` (pure functions, real `Y.Doc`) | `npm run test:unit` |
| `test:component` | `tests/component/**` (jsdom, real `Y.Doc` + `testbox` fixture) | `npm run test:component` |
| `test:e2e` | `tests/e2e/**` (built app against `wrangler dev` + the real BoardRoom DO) | `npm run test:e2e` |

Story-7 files:

- Unit — `tests/unit/geometry.test.ts`, `tests/unit/board-model-group.test.ts`,
  `tests/unit/registry.test.ts`, `tests/unit/selection-reducer.test.ts`.
- Component — `tests/component/multiselect.test.tsx`.
- E2E — `tests/e2e/multiselect.spec.ts` (single-context interactions),
  `tests/e2e/multiselect-full-capacity.spec.ts` (multi-context: TC-35 prune,
  TC-36 concurrent convergence).
- Fixture — `tests/fixtures/testbox.tsx` (a freely-resizable, non-aspect-locked
  rectangle used to prove the transform code is generic, not sticky-specific).

## Running

```sh
npm run test:unit              # geometry / group-ops / registry / reducer
npm run test:component         # jsdom multi-select interactions
npm run test:e2e               # build:test, then Playwright (chromium by default)
# Single-context Story-7 e2e, chromium only:
npx playwright test --project=chromium multiselect multiselect-full-capacity
```

`npm run test:e2e` runs `build:test && playwright test`; the Playwright
`webServer` starts `wrangler dev` and needs `dist/client` to already exist, so
the build step is required (the scoped `npx playwright test ...` commands above
assume a prior `npm run build:test`).

## What converged (all green at hand-off)

- **Multi-select state** — Shift+click adds/removes one note, `Ctrl/Cmd+A`
  selects all, Escape clears; selection is *local* (never in the `Y.Doc`).
- **Group move** — dragging any member translates the whole selection by the
  same delta; grabbing an unselected note selects only it first.
- **Group delete** — both the SelectionBar button and the `Delete`/`Backspace`
  key remove the whole selection in a *single* transaction.
- **Keyboard** — `Ctrl/Cmd+A` select-all, arrow nudge (fixed world step; Shift =
  large) that does not pan, `Delete` remove-all, `Escape` clear.
- **Marquee** — a Shift+drag over empty space box-selects the notes lying
  *entirely* inside it without panning.
- **Remote-delete prune** — a note deleted by another client leaves my selection
  within the latency budget and the SelectionBar count drops (TC-35, two
  contexts).
- **Concurrent convergence** — two clients transforming different selections at
  once converge to one layout because a transform writes absolute positions
  (TC-36, two contexts).

## What did **not** converge — read before trusting the resize path

1. **Group bounding-box resize is not wired to the UI.** The resize *math* is
   implemented and unit-tested — `resizeRect`, `clampScale` (clamp to
   `STICKY_MIN_SIZE_WORLD` / `MAX_OBJECT_SIZE_WORLD`) and `scaleWithin` in
   `src/shared/geometry.ts`, plus `beginResize`/`resize` in
   `src/client/board/transformController.ts`. But no `SelectionOverlay` / eight
   resize handles are rendered, so there is no `aria-label="Resize …"` element to
   grab and **no component or e2e test drives a resize gesture**. Task 12's
   "bounding-box resize handles" and the resize half of e2e TC-33 are therefore
   **not** covered end-to-end.
2. **E2E was verified in chromium only.** The design also asks TC-32 to run in
   Firefox and WebKit; those runs were not performed here.
3. **`clampScale` is per-axis.** The task text said "one uniform clamped scale";
   this build scales width and height independently. The geometry unit tests
   encode the per-axis contract and pass, so this is a documented *deviation*, not
   a failure — but it is a deviation from the wording of task 2.