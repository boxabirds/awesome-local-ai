import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/(.*)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(req);
    let boardId: string;
    try {
      boardId = decodeURIComponent(match[1]);
    } catch {
      return new Response('Invalid board id', { status: 400 });
    }
    if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    // One room object per board: isolation. No participant counting: soft capacity.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
} satisfies ExportedHandler<Env>;
