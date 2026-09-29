// Worker entry: route WebSocket upgrades for /api/rooms/:boardId to that board's
// BoardRoom Durable Object, and everything else to the static assets binding.
// See design "Worker entry and routing".

import { isValidBoardId } from '../shared/board-id.ts';
import { BoardRoom } from './board-room.ts';
import { parseTestHook, testHookNotFound, testHooksEnabled } from './test-hooks.ts';

export { BoardRoom } from './board-room.ts';
export { testHooksEnabled, parseTestHook } from './test-hooks.ts';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Set to '1' only by the persistence e2E harness (`wrangler dev --var`). Enables
   * the /__test/boards/:id/… storage actions design TC-24 needs; absent everywhere
   * else, where those routes answer 404. See `src/worker/test-hooks.ts`.
   */
  VIDI_TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROOM_PATH.exec(url.pathname);
    const testHook = parseTestHook(url.pathname);

    if (url.pathname.startsWith('/__test/')) {
      // Anything under /__test/ that is not an enabled, well-formed hook call is
      // simply not here — never the SPA fallback, so a mis-typed hook call can
      // never look like a working route.
      if (!testHook || !testHooksEnabled(env) || request.method !== 'POST') {
        return testHookNotFound();
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(testHook.boardId)).fetch(request);
    }

    if (match) {
      const boardId = match[1];
      // Validate before touching the namespace so an invalid id can never
      // instantiate a Durable Object (TC-04).
      if (!isValidBoardId(boardId)) {
        return new Response('invalid board id', { status: 400 });
      }
      const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      // idFromName(boardId) gives each board its own object — this is what keeps
      // boards isolated (live.isolation). There is deliberately no participant
      // count check: an over-capacity joiner is never refused (live.over_capacity).
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
