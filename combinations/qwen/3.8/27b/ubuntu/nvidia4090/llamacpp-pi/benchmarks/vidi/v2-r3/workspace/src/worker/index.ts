import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { testHookRequest } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' enables the /__test hook routes (test wrangler processes only). */
  TEST_HOOKS?: string;
}

export { BoardRoom };

const ROOMS_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (env.TEST_HOOKS === '1' && url.pathname.startsWith('/__test/')) {
      return testHookRequest(req, env, url.pathname);
    }
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = decodeURIComponent(url.pathname.slice(ROOMS_PREFIX.length));
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgrade = req.headers.get('Upgrade');
      if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      // One BoardRoom object per board id: boards stay separate.
      // No participant counting: the 6th+ joiner is never refused (soft capacity).
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return room.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};
