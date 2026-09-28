/**
 * Worker entry: routes /api/rooms/:boardId to BoardRoom Durable Object,
 * everything else to static assets.
 */
import { isValidBoardId } from '../shared/board-id';
import { matchTestHook } from './test-hooks';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * Set to '1' by the e2e wrangler process only (`--var TEST_HOOKS:1`). Enables
   * the /__test/boards/:id/* storage hooks; never set in wrangler.jsonc.
   */
  TEST_HOOKS?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Test-only storage hooks, forwarded to the board's Durable Object.
    if (env.TEST_HOOKS === '1') {
      const route = matchTestHook(url.pathname, url.searchParams);
      if (route !== null && isValidBoardId(route.boardId)) {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(route.boardId));
        return stub.fetch(req);
      }
    }

    // Route WebSocket upgrade to Durable Object
    if (url.pathname.startsWith('/api/rooms/')) {
      const boardId = url.pathname.slice('/api/rooms/'.length);

      // Strip any trailing path segments (e.g. /api/rooms/id/ws)
      const idPart = boardId.split('/')[0];

      if (!isValidBoardId(idPart)) {
        return new Response('Invalid board ID', { status: 400 });
      }

      const upgradeHeader = req.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const doId = env.BOARD_ROOM.idFromName(idPart);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(req);
    }

    // Everything else: serve static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
