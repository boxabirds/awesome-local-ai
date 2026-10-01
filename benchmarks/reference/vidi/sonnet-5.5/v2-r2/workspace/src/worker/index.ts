import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export interface Env { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher; TEST_HOOKS?: string }

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (env.TEST_HOOKS === '1') {
      const hook = await handleTestHook(req, env, pathname);
      if (hook) return hook;
    }
    const match = ROOM_PATH.exec(pathname);
    if (!match) return env.ASSETS.fetch(req);
    if (!isValidBoardId(match[1])) return new Response('Bad Request', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1])).fetch(req);
  },
};

export { BoardRoom } from './board-room';
