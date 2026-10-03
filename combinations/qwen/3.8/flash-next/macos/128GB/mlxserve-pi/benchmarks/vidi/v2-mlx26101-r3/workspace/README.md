# vidi6

A shared board for thinking together.

## Run it

```bash
npm install
npm run dev        # client on http://127.0.0.1:23600
npm run preview    # the built client served by wrangler (assets-only Worker), :23612
```

## Check it

```bash
npm run verify     # typecheck + build + no-test-hook + unit + component + e2e (Chromium)
npm run test:unit  # camera maths (node)
npm run test:component # viewport input, zoom controls, hint (jsdom)
npm run test:e2e   # Playwright against wrangler dev; BROWSERS=all adds Firefox + WebKit
```

Story 1 implements navigation of the infinite board (pan, zoom, limits, reset view).
[NOTES.md](NOTES.md) has the exact commands, deviations from the story design and gotchas.
Specs live in [spec/](spec).
