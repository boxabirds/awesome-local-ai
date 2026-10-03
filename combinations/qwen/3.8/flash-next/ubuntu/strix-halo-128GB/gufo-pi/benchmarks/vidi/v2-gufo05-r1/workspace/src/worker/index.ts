/**
 * The Worker entry: the only thing between a browser and a board.
 *
 * Two jobs, and nothing else.
 *
 * - `/api/rooms/<boardId>` with a WebSocket upgrade goes to that board's
 *   `BoardRoom`. `idFromName(boardId)` is what keeps boards separate
 *   (`live.isolation`): every connection for one address lands in the same
 *   object, which holds only that board's document and talks only to its own
 *   sockets.
 * - everything else goes to the built client (`dist/client`), which handles its
 *   own routes (`/b/<boardId>`) in the browser.
 *
 * Nobody is counted anywhere. The product's `MAX_CONCURRENT_EDITORS` is a design
 * and test target, so a 6th person is accepted exactly like anyone else
 * (`live.over_capacity`).
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { testHooksEnabled } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * `1` routes the `/__test/boards/:boardId/...` endpoints, which exist so a test can
   * break a board on purpose (see `src/worker/test-hooks.ts`). Absent everywhere else:
   * without it the path is not routed at all, and the room refuses it a second time.
   */
  TEST_HOOKS?: string;
}

const ROOM_PATH = '/api/rooms';
const ROOM_PREFIX = `${ROOM_PATH}/`;
const TEST_HOOK_PREFIX = '/__test/boards/';

/** Case-insensitive `Upgrade: websocket`, as the fetch spec says to check it. */
function wantsWebSocket(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').toLowerCase().includes('websocket');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // A board's storage belongs to its own object, so even a test that wants to damage
    // it has to ask that object. The path is `/__test/boards/<boardId>/<action>`; the
    // room parses the action and checks `TEST_HOOKS` again.
    if (testHooksEnabled(env) && pathname.startsWith(TEST_HOOK_PREFIX)) {
      const boardId = pathname.slice(TEST_HOOK_PREFIX.length).split('/')[0] ?? '';
      if (!isValidBoardId(boardId)) return new Response('invalid board id', { status: 400 });
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
    }

    if (pathname !== ROOM_PATH && !pathname.startsWith(ROOM_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    const boardId = pathname.slice(ROOM_PREFIX.length);
    if (!isValidBoardId(boardId)) {
      return new Response('invalid board id', { status: 400 });
    }
    if (!wantsWebSocket(request)) {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};

export { BoardRoom };
