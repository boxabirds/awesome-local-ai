import { isValidBoardId } from '../shared/board-id';
import type { Env } from './env';

export type { Env } from './env';
export { BoardRoom } from './board-room';

const ROOM_PATH_PREFIX = '/api/rooms/';

/**
 * Worker entry. `/api/rooms/:boardId` upgrades to the board's BoardRoom
 * Durable Object; everything else is served from static assets (SPA fallback
 * is configured on the assets binding). Board isolation comes from
 * `idFromName(boardId)` — one object instance per board address.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(ROOM_PATH_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PATH_PREFIX.length);
      if (!isValidBoardId(boardId)) {
        return new Response('Invalid board id', { status: 400 });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
