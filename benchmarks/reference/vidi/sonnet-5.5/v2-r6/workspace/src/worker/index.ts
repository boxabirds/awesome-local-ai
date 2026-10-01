import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';

export interface Env { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher; TEST_HOOKS?: string }

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const TEST_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (env.TEST_HOOKS === '1' && req.method === 'POST') {
      const hook = TEST_PATH.exec(path);
      if (hook && isValidBoardId(hook[1])) {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook[1]));
        return stub.fetch(new Request(`https://room/__test/${hook[2]}`, { method: 'POST' }));
      }
    }
    const match = ROOM_PATH.exec(path);
    if (!match) return env.ASSETS.fetch(req);
    let boardId: string;
    try { boardId = decodeURIComponent(match[1]); } catch { boardId = ''; }
    if (!isValidBoardId(boardId)) return new Response('Bad Request', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
};

export { BoardRoom } from './board-room';
