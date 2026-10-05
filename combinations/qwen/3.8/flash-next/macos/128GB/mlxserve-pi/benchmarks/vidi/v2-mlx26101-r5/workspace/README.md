# vidi6

A shared board for thinking together.

## Running the board

```bash
npm install          # dependencies
npm run dev          # dev server (http://localhost:20786)
npm run build        # production build into dist/client
npm run e2e:serve    # build the test build and serve it with `wrangler dev` (http://127.0.0.1:20784)
```

Ports can be moved inside the allowed range with environment variables:
`VIDI6_DEV_PORT` (Vite dev/preview, default 20786), `VIDI6_E2E_PORT` (Playwright +
`wrangler dev`, default 20784) and `VIDI6_E2E_INSPECTOR_PORT` (wrangler inspector,
default 20785).

## Tests

```bash
npm run test         # all Vitest projects (unit + component)
npm run test:unit    # pure camera maths, node
npm run test:component # React components in jsdom (Testing Library)
npm run typecheck    # tsc --noEmit
npm run test:e2e     # Playwright against `wrangler dev` (starts the server itself)
```

`npm run test:e2e` runs the Chromium project. Firefox and WebKit are opt-in with
`VIDI6_E2E_PROJECTS=chromium,firefox,webkit npm run test:e2e` — they cannot start
in some sandboxes (see [NOTES.md](NOTES.md)).

## Navigating the board

| Gesture / key | Effect |
|---|---|
| Drag the empty board | Pan: content follows the pointer 1:1 |
| Scroll / two-finger swipe | Pan |
| Ctrl/Cmd + scroll, trackpad pinch | Zoom around the pointer |
| Pinch (Safari) | Zoom around the pointer |
| <kbd>Ctrl/Cmd</kbd> + <kbd>=</kbd> | Zoom in one step (×1.25) |
| <kbd>Ctrl/Cmd</kbd> + <kbd>-</kbd> | Zoom out one step (÷1.25) |
| <kbd>Ctrl/Cmd</kbd> + <kbd>0</kbd> | Reset view: 100 %, starting point centred |
| − / + buttons, **Reset view** | Same as the keys, around the centre |

Zoom is clamped to 10 %–400 %. None of these gestures zoom or scroll the page:
the board prevents the browser's own behaviour on every one of them.

## Layout

- `src/client/canvas/camera.ts` — pure camera maths (world ↔ screen, pan, zoom-at-point, clamping)
- `src/client/canvas/useCamera.ts` — camera state and input handlers
- `src/client/canvas/BoardViewport.tsx` — input surface, dot grid, world layer
- `src/client/canvas/ZoomControls.tsx` — − / % / + / Reset view
- `src/client/canvas/NavigationHint.tsx` — first-use hint
- `src/shared/config.ts` — named settings (zoom limits, step, grid spacing)
- `tests/unit`, `tests/component`, `tests/e2e` — the three test scopes
