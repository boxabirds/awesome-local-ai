# vidi6

A shared board for thinking together.

## Story 1 — pan and zoom around an infinite board

The client is a full-window board surface that can be panned and zoomed without
edges:

- **Pan** by dragging the empty board, or by scrolling / trackpad-scrolling
  (both axes) over it.
- **Zoom** around the pointer with `Ctrl`/`Cmd` + scroll or a trackpad pinch,
  with the `−`/`+` buttons, or with `Ctrl`/`Cmd` + `=` / `-`. `10%`–`400%`.
- **Reset view** with the button or `Ctrl`/`Cmd` + `0`: 100% zoom with the
  board's starting point (world `0,0`) centred.
- A dot grid at `GRID_SPACING_WORLD` world units that always looks attached to
  the board, and a first-use hint that disappears on the first navigation.

Board gestures never zoom the browser page: every input the board consumes calls
`preventDefault`.

## Requirements

- Node 22+, npm.
- For e2e: a Playwright browser (`npx playwright install chromium`) and `wrangler`
  (a dev dependency) able to run locally.

## Running

```sh
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # production client build into dist/client
npm run wrangler:dev  # serve dist/client the way Cloudflare does
```

## Testing

```sh
npm run typecheck
npm run test:unit        # camera maths, node project
npm run test:component   # viewport / controls / hint, jsdom project
npm run test:e2e         # Playwright: builds --mode test, serves it with wrangler dev
```

`test:e2e` starts its own web server (`npm run build:test && wrangler dev --local`).
That build mode is what exposes the `window.__vidi6` test hook used to jump the
camera a million units without dragging a million pixels; the hook is compiled
out of production builds. If only some browsers are installed, set
`E2E_BROWSERS` to a comma separated list, e.g. `E2E_BROWSERS=chromium npm run test:e2e`.

See [NOTES.md](NOTES.md) for implementation decisions and deviations from the story design.
