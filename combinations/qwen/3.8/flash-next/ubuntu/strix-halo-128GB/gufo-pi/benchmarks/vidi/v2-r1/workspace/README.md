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

## Story 2 — capture ideas on sticky notes and rearrange them

Notes live in a `Y.Doc` held in memory (`useBoardDoc`), so everything on the
board is one shared data structure already - collaboration is story 3.

- **Create** by double-clicking empty board (centred on the pointer) or with the
  `Sticky note` button on the left toolbar (centred on the middle of the view,
  wherever the camera is). A new note opens for typing straight away.
- **Type** into the note. Text is written to the shared document on every
  keystroke, is clamped to `STICKY_TEXT_MAX_CHARS` (1,000) characters, shows a
  counter when `STICKY_COUNTER_THRESHOLD_CHARS` (50) or fewer are left, and
  shrinks its text from 24px down to a readable 10px to fit;
  text still too long is clipped with a fade. `Enter` adds a newline, `Escape`
  finishes editing.
- **Select** by pressing a note; the selected note gets an outline and a floating
  toolbar with six colours and a bin.
- **Move** by dragging. A drag raises the note above the others, moves it by
  `delta / zoom` world units (so the point that was grabbed stays under the
  pointer at any zoom), and never pans the board.
- **Delete** with the bin, or `Delete`/`Backspace` while the note is selected and
  not being typed into.

Nothing is persisted yet: a reload starts from an empty board.

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
npm run test:unit        # camera maths, board model, text fitting - node project
npm run test:component   # viewport, controls, hint, notes, toolbars - jsdom project
npm run test:e2e         # Playwright: builds --mode test, serves it with wrangler dev
npm run test:all         # vitest (unit + component) then Playwright
```

`test:e2e` starts its own web server (`npm run build:test && wrangler dev --local`).
That build mode is what exposes the `window.__vidi6` test hook used to jump the
camera a million units without dragging a million pixels; the hook is compiled
out of production builds. If only some browsers are installed, set
`E2E_BROWSERS` to a comma separated list, e.g. `E2E_BROWSERS=chromium npm run test:e2e`.

See [NOTES.md](NOTES.md) for implementation decisions and deviations from the story design.
