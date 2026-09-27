// Worker entry (story 3). Routes /api/rooms/:boardId WebSocket upgrades to the
// BoardRoom Durable Object for that board; everything else falls through to the
// static-asset fetcher (SPA fallback comes from the assets config). The board id
// is validated BEFORE any Durable Object is touched, so an invalid id can never
// instantiate a room (PRD live.isolation / TC-04). There is deliberately no
// connection/participant count check: capacity is soft and never enforced.
import { isValidBoardId } from '../shared/board-id.ts';
import { BoardRoom } from './board-room.ts';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_ROUTE = /^\/api\/rooms\/([^/]+)\/?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const match = ROOM_ROUTE.exec(path);
    if (match) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        // 400 before idFromName/get: no object instance is created.
        return new Response('Invalid board id', { status: 400 });
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      // One Durable Object per board id: this is what isolates boards.
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
