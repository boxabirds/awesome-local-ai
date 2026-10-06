# vidi6

A shared board for thinking together.

## Running it

```bash
npm install
npm run dev            # vite dev server on http://127.0.0.1:28820
npm run build          # client build into dist/client
npm run wrangler:dev   # serve dist/client through wrangler dev on http://127.0.0.1:28816
```

## Checking it

```bash
npm run typecheck
npm run test:unit       # camera maths (Vitest, node)
npm run test:component  # viewport input, zoom controls, hint (Vitest + Testing Library, jsdom)
npm run test:e2e        # Playwright against `wrangler dev` (builds with --mode test)
```

`npm run test:e2e` needs Playwright browsers (`PLAYWRIGHT_BROWSERS_PATH=/w/browsers` if they are not in
the default cache). Engines whose browser cannot launch on the host are skipped with a warning; set
`VIDI6_E2E_BROWSERS=chromium,firefox,webkit` to require all three. Story notes are in `NOTES.md`, task
status in `PROGRESS.md`.
