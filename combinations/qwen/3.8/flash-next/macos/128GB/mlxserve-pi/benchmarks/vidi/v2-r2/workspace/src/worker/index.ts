// Worker entry: route `/api/boards` and `/api/boards/:boardId` to board creation
// and to the board-existence answer, route `/api/rooms/:boardId` to that board's
// BoardRoom Durable Object, and serve everything else from the static client
// assets.
//
// Routing is by board id only. `idFromName(boardId)` sends every connection for
// a board to that board's own object, which holds only that board's document and
// broadcasts only to its own sockets — so people on different boards never see
// each other's changes (live.isolation). Nothing here counts participants: a
// person joining a board that already has MAX_CONCURRENT_EDITORS (5) or more is
// accepted like anyone else (live.over_capacity).
//
// Story 5 adds the two addresses a shared link needs, and one rule that applies
// to all three: a board id is validated *before* the Durable Object namespace is
// touched, so `/api/boards/abc` answers "no board" without instantiating - and so
// without writing - anything (TC-07).

import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';

export { BoardRoom };

/**
 * The Worker bindings, merged into the global `Cloudflare.Env` in `env.d.ts` so
 * wrangler, the Durable Object and `cloudflare:test` all agree on one type.
 */
export type Env = Cloudflare.Env;

const ROOM_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const BOARD_PREFIX = '/api/boards/';
/** TEST-ONLY prefix; routed only when `TEST_HOOKS` is `'1'` (see `src/worker/test-hooks.ts`). */
const TEST_PREFIX = '/__test/boards/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The board id in `/api/rooms/:boardId`, or null when the path is not a room. */
function boardIdOf(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null;
  const rest = pathname.slice(ROOM_PREFIX.length);
  // exactly one path segment, no trailing content
  if (rest === '' || rest.includes('/')) return null;
  return decodeURIComponent(rest);
}

/**
 * What kind of board address this is: the collection (`/api/boards`, create) or one
 * board (`/api/boards/:boardId`, existence). The id is returned as-is, valid or
 * not - deciding what a malformed one means is the caller's, and it is the same
 * answer both ways: no such board.
 */
function boardsRouteOf(pathname: string): { id: string | null } | null {
  if (pathname === BOARDS_PATH || pathname === `${BOARDS_PATH}/`) return { id: null };
  if (!pathname.startsWith(BOARD_PREFIX)) return null;
  const rest = pathname.slice(BOARD_PREFIX.length);
  if (rest === '' || rest.includes('/')) return null;
  return { id: decodeURIComponent(rest) };
}

/** `405` with the methods this address does answer, so a wrong verb says so. */
function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: allow },
  });
}

/** The board id and hook name in `/__test/boards/:boardId/<action>`. */
function testHookOf(pathname: string): { boardId: string; action: string } | null {
  if (!pathname.startsWith(TEST_PREFIX)) return null;
  const rest = pathname.slice(TEST_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || rest.indexOf('/', slash + 1) !== -1 || rest.length === slash + 1) return null;
  return { boardId: decodeURIComponent(rest.slice(0, slash)), action: rest.slice(slash + 1) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // TEST-ONLY: hand a storage hook to that board's room. Without `TEST_HOOKS`
    // (which is set only in the e2e environment) this block is skipped and the
    // path is served from assets like any unknown address.
    if (env.TEST_HOOKS === '1') {
      const hook = testHookOf(url.pathname);
      if (hook !== null) {
        if (!isValidBoardId(hook.boardId)) return new Response('Invalid board id', { status: 400 });
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook.boardId));
        return stub.fetch(new Request(`http://room/__test/${hook.action}`, request));
      }
    }

    const boards = boardsRouteOf(url.pathname);
    if (boards !== null) {
      if (boards.id === null) {
        // The collection answers "make one", and nothing else.
        if (request.method !== 'POST') return methodNotAllowed('POST');
        const created = await createBoard(env);
        if (!created.ok) return json({ error: created.reason }, 500);
        return json({ id: created.id }, 201);
      }

      // One board, asked whether it exists. A malformed id is answered here rather
      // than by the board itself: no name lookup, no object, nothing written.
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
      if (!isValidBoardId(boards.id)) return json({ error: 'not_found' }, 404);

      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boards.id));
      try {
        const exists = await stub.exists();
        return exists ? json({ id: boards.id }, 200) : json({ error: 'not_found' }, 404);
      } catch (error) {
        // We could not ask. That is not "the board does not exist" - a page told
        // that would blame a person for a storage outage - so it is a server error
        // and the page retries.
        console.error(
          JSON.stringify({
            event: 'board_exists_failed',
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          }),
        );
        return json({ error: 'check_failed' }, 500);
      }
    }

    const boardId = boardIdOf(url.pathname);
    if (boardId === null) return env.ASSETS.fetch(request);

    // Validate before touching the namespace: an invalid id must never create an
    // object instance (TC-04). Since story 5 a malformed id and an unknown one mean
    // the same thing to a reader, so 400 became 404.
    if (!isValidBoardId(boardId)) {
      return json({ error: 'not_found' }, 404);
    }

    // A valid board id reached over plain HTTP is a missing WebSocket upgrade.
    const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};
