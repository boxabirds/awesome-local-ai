// Worker entry: `/api/rooms/:boardId` goes to that board's BoardRoom, everything
// else to the static client (SPA fallback configured in wrangler.jsonc).
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]*)\/?$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(req);
    let boardId: string;
    try {
      boardId = decodeURIComponent(match[1]);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    // One object per board keeps boards separate; nobody is counted or refused (soft capacity).
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
} satisfies ExportedHandler<Env>;
