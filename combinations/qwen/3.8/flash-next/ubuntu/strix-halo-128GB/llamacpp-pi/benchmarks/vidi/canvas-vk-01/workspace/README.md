# vidi6 — infinite collaborative whiteboard

Client scaffold for the vidi6 whiteboard: Vite + React + TypeScript, served
locally by Cloudflare Workers Assets (`wrangler dev`), the same server used in
production.

## Status

Story 1 — *Pan and zoom around an infinite board* — is implemented: pointer-drag
panning, Ctrl/Cmd + wheel and pinch zoom with 10%/400% clamps, a camera-relative
dot grid, zoom controls, a first-use navigation hint, and `Reset view`.

Story 2 — *Capture ideas on sticky notes and rearrange them* — is implemented:
sticky notes with CRDT text, colours, delete, drag, a note toolbar and font
fitting.

Story 3 — *See other people's edits appear live on the same board* — is
implemented: a board id in the URL (`/b/<id>`), a BoardRoom Durable Object that
relays Yjs sync and awareness between everyone on that id, a `y-websocket` client
provider and a connection badge (Connecting… / Reconnecting… / Connected).
Nothing is stored yet — an empty board id means a new board, and a room that is
restarted starts from its connected peers (story 4 persists it).

See `spec/stories/` for the specifications and `NOTES.md` for implementation
notes, camera maths, the wire format and deviations.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-safe client build into `dist/client` |
| `npm run build:test` | Same, in `test` mode (installs `window.__vidi6`) |
| `npm run preview` | Serve `dist/client` with `wrangler dev` on :8787 |
| `npm run typecheck` | `tsc --noEmit` over the client and tests, and over the worker with `tsconfig.worker.json` |
| `npm run test:unit` | Vitest, node: camera maths, board model, sticky text, board ids, protocol frames |
| `npm run test:component` | Vitest, jsdom: viewport, toolbars, sticky note, text editor, connection badge |
| `npm run test:integration` | Vitest in workerd: Worker routing and the BoardRoom over real WebSockets |
| `npm run test:e2e` | Playwright: builds in test mode, serves with wrangler, multi-context collaboration |
| `npm run test:e2e:nightly` | Playwright, long-running: idle connection stability and the capacity soak |

`npm install` needs `--legacy-peer-deps` (npm 9 mis-resolves `y-websocket`'s peer
range).

## Layout

```
index.html
playwright.config.ts        device matrix, wrangler webServer
src/shared/config.ts        camera, input and grid constants (single source)
src/client/main.tsx         mount root
src/client/App.tsx          CameraProvider + BoardViewport + BoardOverlays
src/client/canvas/camera.ts     pure camera maths (pan/zoom/clamp/convert)
src/client/canvas/useCamera.ts  CameraStore + React hooks + useViewportSize
src/client/canvas/BoardViewport.tsx  input surface, grid, world layer
src/client/canvas/ZoomControls.tsx   -, percentage, +, Reset view
src/client/canvas/NavigationHint.tsx first-use hint
src/client/canvas/testHooks.ts       window.__vidi6 (test mode only)
src/client/board/            Y.Doc provider, board model binding, selection
src/client/objects/          sticky note, text editor, note toolbar
src/client/sync/             connectBoard (y-websocket) + connection badge
src/shared/board-id.ts       board id generation and validation
src/shared/protocol.ts       y-websocket frame decoding (used by the room)
src/worker/index.ts          fetch router: room sockets -> BoardRoom, rest -> assets
src/worker/board-room.ts     Durable Object: Y.Doc per board, sync + awareness relay
tests/unit/                 node environment
tests/component/            jsdom environment
tests/integration/          workerd (@cloudflare/vitest-pool-workers)
tests/e2e/                  Playwright against wrangler
```
