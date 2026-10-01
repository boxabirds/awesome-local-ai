import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

export interface Env { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher }

const ROOM_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PREFIX.length);
      if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom } from './board-room';
