# vidi6

A shared board for thinking together.

## Story 1 — pan and zoom around an infinite board

Client-only navigation: a pure camera module (`src/client/canvas/camera.ts`)
drives a DOM viewport (`BoardViewport.tsx`) whose world layer and dot grid are
positioned with CSS transforms. Drag, wheel, Safari trackpad gesture and
Ctrl/Cmd keyboard shortcuts navigate the board; a bottom-right zoom control and
a first-use hint complete the story. Settings (zoom limits, step factor, grid
spacing) live in `src/shared/config.ts`.

### Running it

```
npm run dev            # Vite dev server
npm run preview        # the built client served by wrangler dev
npm run typecheck
npm test               # vitest: unit (node) + component (jsdom)
npm run test:e2e       # builds the test bundle, then Playwright on Chromium,
                       # Firefox and WebKit against `wrangler dev`
```

`npm run test:e2e` needs Playwright browsers (`npx playwright install chromium
firefox webkit`) and runs against a test build (`vite build --mode test`), so
`window.__vidi6.setCamera/getCamera` — used to jump to the far end of the
board — exists there and nowhere else: the mode check is constant-folded out of
the production bundle.

### Test layers

| Layer | Where | What it pins down |
| --- | --- | --- |
| Unit | `tests/unit` | camera maths, pointer-invariance to 1e-6, clamping, exact step ladder |
| Component | `tests/component` | input state machine, `preventDefault`, disabled states, hint latch |
| E2E | `tests/e2e` | real pointer/wheel/keyboard input and painted pixels in three browsers |

## Story 4 — return to a board and find everything as it was left

A board's document is stored in the Durable Object's own SQLite storage and is
never broadcast before it is written. `src/worker/board-store.ts` owns the
snapshot/update log (chunked, compacted), the load-on-wake path and the
quarantine for a snapshot that cannot be decoded; `src/worker/board-room.ts`
holds the room's single state machine (`src/worker/room-state.ts`), which is
what decides whether a returning visitor sees their board, an honest
"couldn't be loaded" message, or a room that has been repaired elsewhere.
Nothing is ever put on the wire that the room has not stored, and nothing is
ever invented to replace a board that could not be read.

### Running it

```
npm test                       # unit + component + integration (three vitest projects)
npm run test:integration       # workerd only: the DO, its SQLite storage, real WebSockets
npm run test:e2e               # builds the test bundle, then Playwright on three browsers
npm run preview                # `wrangler dev`: needs the plain worker entry to boot workerd
```

`npm run test:e2e` starts two `wrangler dev` servers (see
`playwright.config.ts`): one with `--env e2e`, where the test-only
`/__test/boards/:id/*` storage routes exist, and one without, whose only job is
to prove they do not. The routes are gated on the `TEST_HOOKS` variable, which
is set in `wrangler.jsonc`'s `e2e` environment and nowhere else; the Durable
Object also refuses them unless the request carries the internal marker the
Worker sets, so neither is reachable from outside.

### Test layers

| Layer | Where | What it pins down |
| --- | --- | --- |
| Unit | `tests/unit/board-store-chunks.test.ts` | chunk/join round-trip, byte and row caps, the state machine's transitions |
| Unit | `tests/unit/room-state.test.ts` | no path from a read failure to an empty-but-editable board |
| Unit | `tests/unit/connection-close-code.test.ts` | 4500 retries, 1011 reconnects, no state ping-pong |
| Component | `tests/component/load-failure.test.tsx` | the banner's copy and the disabled tool layer, in jsdom |
| Integration | `tests/integration/board-store.test.ts` | real SQLite: compaction, rollback when a write fails, cold reads |
| Integration | `tests/integration/board-room-persistence.test.ts` | write-before-broadcast ordering, hibernation, restart-from-empty |
| E2E | `tests/e2e/persistence.spec.ts` | boards that survive a killed server: restart on the same SQLite files, the last write before a broadcast, the large-board open |
| E2E | `tests/e2e/broken-board.spec.ts` | a broken board in a real browser, and its recovery on the same page |

The integration suite runs inside workerd against the same `wrangler.jsonc` the
app deploys with, and evicts the object between cases, so "cold" in a test means
a genuinely new isolate reading stored bytes — not a hand-built document.

`tests/e2e/helpers/wrangler-process.ts` starts and kills a real `wrangler dev`
per case, each over its own `--persist-to` directory, so a restart is a restart
of the files rather than a cache miss.

No test gates on wall-clock time. Measured for scale: a 2,000-note board is
~718 KB of update log over ~4,000 rows; reading it back into a document took
18 ms in workerd, and showing all 2,000 notes in a browser after a server
restart took 175-260 ms here (alone or under parallel load). The load budget in
`config.ts` records the 3 s target; `persistence.spec.ts` prints the figure and
asserts the content, because a hard time gate measures the runner's CPUs rather
than the board.
