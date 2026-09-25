/**
 * Worker entry (anchor: sync.worker_entry): `/api/rooms/:boardId` goes to that board's
 * BoardRoom, everything else to the static client. `idFromName(boardId)` gives each board
 * its own object, which is what keeps boards separate. There is deliberately no
 * participant counting: capacity is a soft design target, never enforced.
 */
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' only in the e2e `wrangler dev` command line; enables src/worker/test-hooks.ts. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BAD_REQUEST = 400;
const UPGRADE_REQUIRED = 426;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: BAD_REQUEST });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: UPGRADE_REQUIRED });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
    }
    const hook = await handleTestHook(req, env);
    if (hook !== null) return hook;
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
