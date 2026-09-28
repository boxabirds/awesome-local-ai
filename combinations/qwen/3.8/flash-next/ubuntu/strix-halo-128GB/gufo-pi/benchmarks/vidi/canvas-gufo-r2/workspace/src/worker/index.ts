/**
 * Worker entry: routes /api/rooms/:boardId to BoardRoom Durable Object,
 * everything else to static assets.
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

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
