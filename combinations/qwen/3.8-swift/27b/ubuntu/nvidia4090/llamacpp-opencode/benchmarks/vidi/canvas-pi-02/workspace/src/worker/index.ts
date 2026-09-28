// Worker entry (story 3, sync.worker_entry): routes /api/rooms/:boardId to
// the board's BoardRoom Durable Object and everything else to the static
// assets. Each board id maps to its own object instance, which is what
// isolates boards (PRD live.isolation). There is deliberately no connection
// limit check: the capacity is soft (MAX_CONCURRENT_EDITORS) and over-
// capacity joiners are never refused (PRD live.over_capacity).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOMS_PREFIX = '/api/rooms/';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(new Response('Bad Request', { status: 400 }));
      }
      if (!req.headers.get('Upgrade')?.toLowerCase().includes('websocket')) {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(id).fetch(req);
    }
    return Promise.resolve(env.ASSETS.fetch(req));
  },
};

export { BoardRoom };
