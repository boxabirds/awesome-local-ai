# vidi6

A shared board for thinking together.

## Development

```
npm install
npm run dev            # Vite dev server
npm run build          # production client build into dist/client
npm run wrangler:dev   # serve dist/client through Cloudflare Workers' runtime
```

Tests:

```
npm run test:unit        # camera maths (Vitest, node)
npm run test:component   # viewport input, zoom controls, hint (Vitest + jsdom)
npm run test:e2e         # builds the test bundle, starts wrangler dev, runs Playwright
npm run typecheck
```

`npm run test:e2e` serves the app on port 20194 (the wrangler inspector on 20195, Vite
preview on 20196). It runs the Chromium, Firefox and WebKit projects; on a host without
the browsers' system libraries the missing engines are skipped with a printed reason.
Set `E2E_BROWSERS=chromium,firefox` to choose projects explicitly.

Story 1 implements panning and zooming on an infinite board: see
`spec/stories/001-pan-and-zoom-around-an-infinite-board/`, plus `PROGRESS.md` and
`NOTES.md`.
