// Worker entry: routes `/api/rooms/:boardId` WebSocket upgrades to the
// board's BoardRoom Durable Object and serves everything else from static
// assets (single-page-application fallback). `idFromName(boardId)` keeps
// boards separate; participants are never counted (capacity 5 is a design
// target, never enforced — over-capacity joiners are accepted like anyone
// else).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { maybeHandleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  // Set to '1' by the e2e/dev workers (wrangler dev --var TEST_HOOKS:1) to
  // enable the storage-corruption test hooks. Never set in production.
  TEST_HOOKS?: string;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/?]+)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = ROOM_ROUTE.exec(url.pathname);
    if (match !== null) {
      const boardId = decodeURIComponent(match[1]);
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const upgrade = req.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }
    const hookResponse = await maybeHandleTestHook(req, env);
    if (hookResponse !== null) return hookResponse;
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
