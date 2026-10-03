/**
 * Worker entry point.
 *
 * Routes `/api/rooms/:boardId` to that board's BoardRoom Durable Object and
 * everything else to the static assets (SPA fallback).
 *
 * - invalid board id → 400 (no object instance is created)
 * - valid id without `Upgrade: websocket` → 426
 * - no participant counting: capacity (MAX_CONCURRENT_EDITORS) is a soft
 *   design/test target, never enforced.
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)\/?$/;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = url.pathname.match(ROOM_PATH);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return Promise.resolve(new Response('Bad Request', { status: 400 }));
      }
      const upgrade = req.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return Promise.resolve(new Response('Upgrade Required', { status: 426 }));
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom };
