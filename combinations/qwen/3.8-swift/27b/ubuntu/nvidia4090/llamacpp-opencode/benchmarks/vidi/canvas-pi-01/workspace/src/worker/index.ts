// Worker entry (see spec: sync.worker_entry).
//
// `/api/rooms/:boardId` is the y-websocket route: a valid board id with an
// `Upgrade: websocket` request is forwarded to that board's BoardRoom Durable
// Object (one object per board id, which is what isolates boards). Invalid
// ids get 400 and a valid id without the upgrade header gets 426. Every
// other path falls through to the static assets (SPA fallback serves the
// client for /b/:boardId). There is deliberately no participant counting:
// capacity (MAX_CONCURRENT_EDITORS) is soft and over-capacity joiners are
// never refused.

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)$/;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const match = ROOM_ROUTE.exec(new URL(req.url).pathname);
    if (match !== null && match[1] !== undefined) {
      const boardId = decodeURIComponent(match[1]);
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(new Response('Bad Request', { status: 400 }));
      }
      const upgrade = req.headers.get('Upgrade');
      if (upgrade === null || !upgrade.toLowerCase().includes('websocket')) {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
