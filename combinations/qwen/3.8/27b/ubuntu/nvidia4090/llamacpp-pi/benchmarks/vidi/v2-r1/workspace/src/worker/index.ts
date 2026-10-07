// Worker entry (story 3): routes /api/rooms/:boardId to BoardRoom Durable Object,
// everything else to static assets.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOMS_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);

      // Validate board id
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      // Require WebSocket upgrade
      const upgradeHeader = req.headers.get('upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    // Everything else: static assets (SPA fallback handles /b/:boardId)
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
