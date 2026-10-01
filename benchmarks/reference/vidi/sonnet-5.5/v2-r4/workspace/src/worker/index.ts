import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]*)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const m = ROOM_PATH.exec(new URL(req.url).pathname);
    if (!m) return env.ASSETS.fetch(req);
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (!isValidBoardId(id)) return new Response('Bad Request', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).fetch(req);
  },
};

export { BoardRoom } from './board-room';
