import { BoardRoom } from './board-room';
import { isValidBoardId } from '@/shared/board-id';

/**
 * vidi6 worker entry (story 3).
 *
 * Routes:
 *  - /api/rooms/:boardId  -> the BoardRoom Durable Object (WebSocket upgrade)
 *  - anything else        -> static SPA assets (index.html fallback)
 *
 * The board id is validated with isValidBoardId BEFORE idFromName so a bad id
 * yields 400 without creating a DO instance (TC-04, TC-05).
 */

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);

    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      const isUpgrade = (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
      if (!isUpgrade) {
        return new Response('Upgrade required', { status: 426 });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
