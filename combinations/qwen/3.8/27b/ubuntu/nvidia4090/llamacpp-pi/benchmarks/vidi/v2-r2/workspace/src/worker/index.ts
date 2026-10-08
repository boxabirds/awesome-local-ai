/**
 * vidi6 Worker entry (story 3).
 *
 * Routes `/api/rooms/:boardId` to that board's BoardRoom Durable Object and
 * everything else to the static assets (SPA fallback serves index.html for
 * `/b/<boardId>`).
 *
 * Boards stay separate (live.isolation): `idFromName(boardId)` gives every
 * board its own object instance, so a room only ever sees and broadcasts to
 * sockets on its own board. There is no participant counting and no
 * connection limit (live.over_capacity): the 6th or later person is
 * accepted like anyone else.
 */

import { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const match = ROOM_PATH.exec(new URL(request.url).pathname);
    if (match !== null) {
      const boardId = decodeURIComponent(match[1] ?? '');
      // Invalid id: reject before touching the namespace, so no object
      // instance is created for it (design TC-04).
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgrade = request.headers.get('Upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return new Response('Upgrade Required', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export { BoardRoom };
