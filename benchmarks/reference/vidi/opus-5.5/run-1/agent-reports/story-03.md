# Story 3: final report from the Opus 5.5 subagent

Verbatim, apart from local paths replaced.

Story 3 is built and committed as `c7b638a` ("story 3: See other people's edits appear live on the same board"). Build, typecheck and every test script pass. E2E was run in Chromium and Firefox only, because WebKit can't launch on the build machine.

## What I built
- **Server**
  - A Worker at `src/worker/index.ts` routes `/api/rooms/:boardId` to that board's room. An invalid id gets 400 before any room is touched, and a valid id without a WebSocket upgrade gets 426. Everything else is served from the static client files. The Durable Object binding, migration and `ASSETS` binding are in `wrangler.jsonc`.
  - The room is the `BoardRoom` Durable Object in `src/worker/board-room.ts`. It holds the board in memory and sends each edit to everyone except the sender. It relays presence messages to all sockets, which keeps idle connections alive. It closes only the socket that sends malformed data (close code 1003) and drops sockets it can no longer send to. It does not limit how many people can join.
  - Shared helpers are `src/shared/protocol.ts` (message decoding) and `src/shared/board-id.ts`. The five named settings from the design are in `src/shared/config.ts`.
- **Client**
  - `src/client/sync/connectBoard.ts` wraps the y-websocket provider and turns its events into the four states: connecting, connected, reconnecting and confirmed.
  - `src/client/sync/ConnectionStatus.tsx` is the top-centre badge: "Connecting…", amber "Reconnecting…", then green "Connected" for 2 seconds.
  - `useBoardDoc(boardId)` attaches the connection and closes it on unmount. `App` reads `/b/:boardId`, and any other address is replaced with a new board's address.
- **Fix to story 2's note editor:** an open editor now shows other people's typing as it arrives and keeps your cursor in place. Without this, your next keystroke would have deleted their text.
- **Tests:** all TC-01 to TC-31 from the design, plus a few extra cases.

## Final results
| Script | Result |
|---|---|
| `npm run build` | pass (the production bundle has no `__vidi6` test hook) |
| `npm run typecheck` | pass (both the main and the worker tsconfig) |
| `npm run test:unit` | 69 passed, 0 failed (5 files) |
| `npm run test:component` | 68 passed, 0 failed (7 files) |
| `npm run test:integration` | 23 passed, 0 failed (2 files). An earlier 22-test version also passed 10 runs in a row |
| `npm run test:e2e` (Chromium + Firefox) | 38 passed, 0 failed |
| `npm run test:e2e:nightly` | 2 passed. The 60-second soak with 5 people had a slowest delivery of 76 ms; the median was 10 ms |

## Left undone
- **WebKit e2e:** not run, because the browser can't start on the build machine.
- **One nightly check is missing:** the design asks TC-30 to confirm no reconnect attempts happen after a browser closes. That can't be observed once the page is gone, so a component test checks that unmounting closes the connection instead.
- **`npm run dev`:** it runs the front end only, so the board just shows "Connecting…". For a live board, run `npm run build && npx wrangler dev`.

## Decisions noted in `NOTES.md`
- **Vitest went from 5 to 4.1:** the Cloudflare test pool requires vitest 4.1, and all story 1 and 2 tests still pass on it.
- **Older date for integration tests:** the Workers runtime bundled with the test pool only supports dates up to 2026-08-22, so those tests run at that date. Dev and deploy keep 2026-09-01.
- **`test:integration` builds first:** TC-06 needs the built `index.html`.
- **Binary messages:** at this date the Workers runtime delivers binary messages as `Blob`, so the room sets its sockets to `arraybuffer`.
- **The room decodes sync messages itself:** the standard y-protocols helper swallows errors, so bad updates could never trigger the 1003 close. A malformed state vector is closed the same way, with its own extra test case.
- **`run_worker_first: ["/api/*"]`:** added so room connections always reach the Worker.
- **Separate worker tsconfig:** `tsconfig.worker.json` holds the worker types, and `npm run typecheck` checks both configs.
- **Testable connection:** `connectBoard` takes an optional fourth argument so component tests can drive it with a fake provider.
- **Offline handling:** simulated offline doesn't close an open socket, and y-websocket takes up to 30 seconds to notice. I added browser `offline`/`online` handling so "Reconnecting…" shows immediately and reconnection starts as soon as the network is back.
- **Badge details:** it has `aria-label="Connection status"` (the zoom label is also a status region) and a `data-state` attribute. It shows nothing while connected.
- **Editor with IME:** someone else's edit to the same note during IME input (e.g. Japanese) may interrupt the composition. The text is kept.
- **Addresses:** addresses other than `/b/<valid id>` are replaced without a page reload. This is temporary until story 5.
- **Test setup:**
  - Test builds expose `window.__vidi6.connectionState`.
  - Component tests replace `WebSocket` with a socket that never opens.
  - The server-restart test does a real restart of the same room rather than using a new room id. The runtime logs an expected "restart" exception line during it.
- **Separate nightly script:** TC-29 and TC-30 run via `npm run test:e2e:nightly`, not the default e2e run.
- **Red phase not committed separately:** the task 1 tests failed 12/12 against stubs before I implemented them, and everything is in the single story commit.
