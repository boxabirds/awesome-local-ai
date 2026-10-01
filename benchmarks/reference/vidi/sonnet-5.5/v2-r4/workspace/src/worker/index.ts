import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string; // '1' only in the e2e wrangler run
}

const ROOM_PATH = /^\/api\/rooms\/([^/]*)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const hook = await handleTestHook(req, env);
    if (hook) return hook;
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
