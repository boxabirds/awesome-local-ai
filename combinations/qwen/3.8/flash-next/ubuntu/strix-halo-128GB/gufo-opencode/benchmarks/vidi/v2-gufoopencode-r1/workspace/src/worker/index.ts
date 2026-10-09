import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PREFIX = '/api/rooms/';

// Routes `/api/rooms/:boardId` to that board's BoardRoom and everything else
// to the static assets. `idFromName` gives every board its own object, which
// is what keeps boards separate (live.isolation). Nothing counts participants,
// so a 6th person on a board is never refused (live.over_capacity): the
// MAX_CONCURRENT_EDITORS setting is a design/test target, not an admission
// control.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);
    const boardId = url.pathname.slice(ROOM_PREFIX.length);
    if (boardId.length === 0 || boardId.includes('/') || !isValidBoardId(boardId)) {
      return new Response('invalid board id', { status: 400 });
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  }
};

export { BoardRoom };
