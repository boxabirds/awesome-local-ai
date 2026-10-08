# Notes

## Playwright browser availability

Playwright browser binaries (Chromium, Firefox, WebKit) cannot be downloaded in this environment:
the browser download CDN returns HTTP 403 and no system Chrome is available.

Consequence: `npm run test:e2e` exits with code 0 but **all 13 e2e tests are skipped**
(`test.skip(!hasBrowser(), …)` at the module level in `navigation.spec.ts`).

The tests are written and logically correct; they will run automatically once
`npx playwright install` succeeds.  `playwright.config.ts` detects installed browsers
at startup and only creates Playwright projects for browsers whose executable exists.

## `webServer` uses `vite` rather than `wrangler dev`

The design mentions `webServer = wrangler dev serving dist/client`.
This project uses `vite` directly as the Playwright webServer.

Rationale:
- The Story 1 tests exercise client-side navigation only; no Worker code runs until Story 3.
- `vite` (dev mode) requires no build step; `wrangler dev` requires `npm run build` first.
- `import.meta.env.DEV` is true under `vite`, which activates the `__vidi6.setCamera` test
  hook needed by TC-26 and TC-27.
- Under a `wrangler dev` workflow the hook would also be available if the build uses
  `--mode development`; however a plain `vite build` (production mode) would omit the hook.

To switch to `wrangler dev` once Worker code lands, replace `webServer.command` in
`playwright.config.ts` with:

```
command: 'npm run build && npx wrangler dev --port 25776'
```

## test:component uses jsdom; PointerEvent + rAF polyfills

`tests/component/setup.ts` provides:
- `PointerEvent` polyfill (extends `MouseEvent`) because jsdom does not implement it.
- `ResizeObserver` mock.
- Synchronous `requestAnimationFrame` override (jsdom's built-in rAF is async via
  setTimeout; tests need the callback to fire inline so that drag/move assertions
  can check results without async plumbing).
- `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture` no-ops.

Event handling in `BoardViewport.tsx` uses `addEventListener` (not React synthetic events)
so that dispatching synthetic events in tests exercises the same code path as a real browser.

## testHooks: `import.meta.env.DEV` rather than `MODE === 'test'`

The design spec says `window.__vidi6.setCamera` should be enabled when
`import.meta.env.MODE === 'test'`.  The implementation uses `import.meta.env.DEV` instead.

Reason: Playwright e2e tests run against `vite --mode development` (not `--mode test`),
so `MODE === 'test'` would omit the hook during e2e runs and break TC-26/TC-27.
`import.meta.env.DEV` is true in both development and Vitest test modes, but false in
`vite build` (production), which correctly excludes the hook from production bundles.

## One damaged change: the board is refused, not half-served (story 4, task 3)

`persist.partial_damage` and design TC-09 were written assuming the update log can be
replayed with a hole in it: quarantine the damaged row, apply the rest, and the joiner
sees "all other saved content intact".

Measured on the 25-note fixture (`tests/fixtures/boards.ts`, 75 log rows), that is not
how Yjs behaves. `Y.applyUpdate` **silently drops** an update whose dependencies are
missing: replaying all 75 rows gives 25 notes, replaying them with row 7 skipped or
damaged gives **2 notes**. Same result with the row quarantined first and the rest
applied one by one, and with `doc.transact()` wrapping each row. A hole in a log of
per-transaction updates is not a lost change, it is everything after the hole.

So `BoardStore.load` does the safer of the two things:

- the damaged row is still moved to `quarantined_updates` with its error text, so the
  same corruption does not fail on every wake and an operator can inspect it;
- the replay stops there and returns `{ok:false, reason:'log-unreadable'}`, the room
  discards the half-read doc, and the client shows the load-failure state (red message,
  editing disabled, Retry) instead of a board that is quietly missing 23 notes.

Why this is the right side of the trade:

- Serving the partial board would violate `persist.load_failure` one requirement higher
  up in the PRD ("SHALL NOT present it as an empty editable board") — 2 notes out of 25
  is an empty board with extra steps — and the next compaction would fold the loss into
  the snapshot, making it permanent and unwarned.
- Damage cannot arrive from a client: every update is applied to the in-memory doc
  before it is stored (design decision 2), and Yjs rejects garbage on the way in. The
  load-side damage paths only ever fire on storage corruption, where "we could not read
  your board" is the honest message.

TC-09 keeps both halves of that evidence: it asserts the row is quarantined *and*
asserts that a loader which trusted the remaining rows would have served fewer than 5
notes, so the deviation is measured in the test rather than argued in prose.
