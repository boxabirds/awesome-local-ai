import { isValidBoardId } from '../shared/board-id';
import { ROOM_PATH_PREFIX } from '../shared/protocol';
import { BoardRoom, TEST_HOOK_PREFIX } from './board-room';

/**
 * Everything the Worker needs from the platform: the room namespace and the built
 * client. See `wrangler.jsonc` for the bindings.
 */
export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /**
   * `'1'` turns on the room's test-only storage routes (`/__test/...`), and is never
   * set in production config — the default deployment has no way to damage a board
   * through the front door (design: "Test hooks are the only non-protocol route").
   */
  TEST_HOOKS?: string;
}

/** Everything under the prefix belongs to the room: `/api/rooms/` owns its whole tree. */
function boardIdOf(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PATH_PREFIX)) return null;
  const encoded = pathname.slice(ROOM_PATH_PREFIX.length);
  // An empty or undecodable address is an invalid id (400), never a route to the client.
  if (encoded === '') return '';
  try {
    // `%2F` decoding to a `/` is checked against the id pattern by the caller.
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

/** True when the request is the WebSocket upgrade a board client sends. */
function isUpgrade(request: Request): boolean {
  return request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

/**
 * The whole Worker: `/api/rooms/:boardId` belongs to that board's room, everything
 * else is the client. There is no participant counting anywhere in here — the
 * `MAX_CONCURRENT_EDITORS` capacity is a design and test target, never enforced, so a
 * sixteenth person joins exactly like a first one (`live.over_capacity`).
 *
 * Boards stay separate (`live.isolation`) because `idFromName(boardId)` gives every
 * board its own `BoardRoom` object, and that object only knows its own sockets.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // `/__test/:boardId/...` are the room's storage-damage routes; the room itself
    // answers 404 unless `TEST_HOOKS` is on, so production never exposes them.
    if (pathname.startsWith(TEST_HOOK_PREFIX)) {
      const parts = pathname.slice(TEST_HOOK_PREFIX.length).split('/');
      const hookBoardId = parts[0] ?? '';
      if (parts.length < 2 || !isValidBoardId(hookBoardId)) {
        return new Response('invalid test hook path', { status: 400 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hookBoardId)).fetch(request);
    }

    const boardId = boardIdOf(pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    if (!isValidBoardId(boardId)) {
      return new Response('invalid board id', { status: 400 });
    }
    if (!isUpgrade(request)) {
      // The room speaks WebSockets only; the client's own address is a page, not an API.
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }
    // `get(...).fetch(...)` hands the upgrade to the room, which answers 101 itself.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
};

export { BoardRoom };
