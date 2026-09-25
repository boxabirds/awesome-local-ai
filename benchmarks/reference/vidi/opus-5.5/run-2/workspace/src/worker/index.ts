/**
 * Worker entry (anchors: sync.worker_entry, share.board_api):
 *
 *   POST /api/boards        create a board (rate limited per visitor)  201 {id} / 429 / 500
 *   GET  /api/boards/:id    does the board exist?                      200 {id} / 404
 *   GET  /api/rooms/:id     WebSocket to the board's BoardRoom          101 / 404 / 426
 *
 * Everything else goes to the static client. Ids are validated before the namespace is
 * touched, so malformed ids never instantiate an object; unknown and malformed ids get the
 * same 404 so nothing is leaked. Existence checks only read storage: probing links leaves
 * nothing behind. There is deliberately no participant counting (capacity is a soft target).
 */
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleBoardsRequest, type Limiter } from './create-board';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  BOARD_CREATE_LIMITER: Limiter;
  /** '1' only in the e2e `wrangler dev` command line; enables src/worker/test-hooks.ts. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const NOT_FOUND = 404;
const UPGRADE_REQUIRED = 426;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === BOARDS_PATH || url.pathname.startsWith(`${BOARDS_PATH}/`)) {
      return handleBoardsRequest(req, env);
    }
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);
      if (!isValidBoardId(boardId)) return new Response('Board not found', { status: NOT_FOUND });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: UPGRADE_REQUIRED });
      }
      // The room itself answers 404 for a board that does not exist, before accepting.
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
    }
    const hook = await handleTestHook(req, env);
    if (hook !== null) return hook;
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
