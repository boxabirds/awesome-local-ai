/**
 * vidi6 Worker entry.
 *
 * Two kinds of request:
 * - `/api/rooms/:boardId` with `Upgrade: websocket` → that board's `BoardRoom`
 *   object. `idFromName(boardId)` is what keeps boards separate: every
 *   connection for a board lands on the object that holds only that board's
 *   document.
 * - everything else → the static client assets.
 *
 * Neither the Worker nor the room counts participants, so a 6th (or 50th)
 * person on a board is never refused: `MAX_CONCURRENT_EDITORS` is a design and
 * test target, not a limit.
 */

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { TEST_HOOK_PREFIX, parseTestHook, testHooksEnabled } from './test-hooks';

export interface Env {
  /** The room per board (one object instance per board id). */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** Static client build. */
  ASSETS: Fetcher;
  /**
   * `1` turns on the storage test hooks under `/__test/boards/`. Set only by the
   * e2e dev server; absent from the production configuration, which is what makes
   * those routes unreachable in a real deployment.
   */
  TEST_HOOKS?: string;
}

/** Everything under this prefix is a board's WebSocket endpoint. */
const ROOM_PREFIX = '/api/rooms/';
/** The board collection (POST to create) and a single board (GET to check). */
const BOARDS_PATH = '/api/boards';
const BOARD_PREFIX = '/api/boards/';

/** True for `Upgrade: websocket` (case-insensitive, as HTTP requires). */
function isUpgradeToWebsocket(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Storage test hooks: forwarded to the board's own object, which is where the
    // storage actually is. Unknown paths fall through to the assets untouched.
    if (testHooksEnabled(env) && pathname.startsWith(TEST_HOOK_PREFIX)) {
      const hook = parseTestHook(pathname);
      if (!hook) return new Response('Unknown test hook', { status: 404 });
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook.boardId));
      return room.fetch(request);
    }

    // --- the board API ------------------------------------------------------

    if (pathname === BOARDS_PATH) {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const result = await createBoard(env);
      if (result.ok) return json({ id: result.id }, 201);
      return json({ error: 'create_failed' }, 500);
    }

    if (pathname.startsWith(BOARD_PREFIX)) {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      const boardId = pathname.slice(BOARD_PREFIX.length);
      // A malformed id is not a board, and must never reach (or create) a Durable
      // Object. Unknown and malformed ids get the same 404: nothing is leaked.
      if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
      const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await room.exists();
      return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
    }

    if (!pathname.startsWith(ROOM_PREFIX)) return env.ASSETS.fetch(request);

    const boardId = pathname.slice(ROOM_PREFIX.length);
    // A board address is 22 base64url characters; anything else is a mistake or
    // a probe, and must not reach (or create) a Durable Object. Reported as 404
    // so a probe cannot tell a malformed id from an unknown one (share.not_found).
    if (!isValidBoardId(boardId)) {
      return new Response('Board not found', { status: 404 });
    }
    if (!isUpgradeToWebsocket(request)) {
      return new Response('Upgrade Required', { status: 426 });
    }

    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return room.fetch(request);
  },
};

export { BoardRoom };
