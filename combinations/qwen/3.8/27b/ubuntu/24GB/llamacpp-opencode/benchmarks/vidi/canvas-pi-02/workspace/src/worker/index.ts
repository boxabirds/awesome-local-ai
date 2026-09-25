import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

/**
 * Worker entry (story 3).
 *
 * One route: `/api/rooms/:boardId` upgrades to a WebSocket and is handled by
 * the BoardRoom Durable Object named after the board id — `idFromName` per
 * board is what keeps boards isolated. Every other path is served from the
 * static client build (SPA fallback for `/b/:boardId`).
 *
 * There is deliberately no participant counting or connection limit: the
 * capacity (MAX_CONCURRENT_EDITORS) is a soft, test-driven setting and an
 * over-capacity joiner is never refused (live.over_capacity).
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Test hooks are enabled only when this is exactly '1' (the e2e env). */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const hookResponse = await handleTestHook(req, url, env);
    if (hookResponse !== null) return hookResponse;
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomMatch !== null) {
      const boardId = roomMatch[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgrade = req.headers.get('upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return new Response('Upgrade Required', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
