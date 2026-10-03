// Worker entry (sync.worker_entry).
//
// Routes `/api/rooms/:boardId` (valid id + Upgrade: websocket) to that
// board's BoardRoom Durable Object; everything else goes to the static
// assets fetcher with SPA fallback.
//
// Boards stay separate (live.isolation): `idFromName(boardId)` maps every
// board to its own object instance, which holds only that board's Y.Doc and
// broadcasts only to its own sockets.
//
// Over-capacity joins are never refused (live.over_capacity): the Worker and
// the room never count participants; MAX_CONCURRENT_EDITORS is a soft design
// and test target only.

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
      const upgrade = (req.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
