import { isValidBoardId } from '@shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Route /api/rooms/:boardId to the Durable Object
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request: invalid board id', { status: 400 });
      }
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      const doId = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(doId);
      return stub.fetch(req);
    }

    // Everything else goes to static assets
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
