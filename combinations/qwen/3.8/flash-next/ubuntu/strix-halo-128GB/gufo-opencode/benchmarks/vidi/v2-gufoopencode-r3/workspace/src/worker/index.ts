import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

// /api/rooms/:boardId upgrades to the board's BoardRoom Durable Object;
// everything else is served from static assets (SPA fallback).
// idFromName(boardId) gives every board its own object, so boards stay
// separate (live.isolation). No participant counting: the capacity setting
// is soft, over-capacity joiners are never refused (live.over_capacity).
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROOM_PATH.exec(url.pathname);
    if (match !== null) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id\n', { status: 400 });
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required\n', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export { BoardRoom };
