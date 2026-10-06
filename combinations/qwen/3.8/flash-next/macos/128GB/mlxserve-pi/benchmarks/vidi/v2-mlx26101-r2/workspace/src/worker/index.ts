/**
 * The Worker entry point: the only thing in front of the client assets.
 *
 * `/api/rooms/:boardId` is the board's live connection: a valid id with an
 * `Upgrade: websocket` header is forwarded to that board's `BoardRoom` Durable
 * Object, and everything else — the board page itself, the scripts and styles
 * it loads — comes from the static assets.
 *
 * `/__test/boards/:boardId/*` is forwarded to the same object, but only when the
 * `TEST_HOOKS` binding says this deployment is a test. Without it the Worker answers
 * those paths itself with the same 404 its object gives them, because they are in this
 * Worker's own namespace and the answer to a path in the namespace that this deployment
 * does not have is "not found" - not the app page, which is what handing them to the
 * assets would produce, and not 403, which would confirm that the board in the address
 * is real. `tests/e2e/test-routes.spec.ts` starts a server without the variable and asks
 * all five routes of it, which is how a production build is verified not to have them.
 *
 * Boards stay separate because `idFromName(boardId)` gives every board its own
 * object, which holds only that board's document and broadcasts only to its own
 * sockets. Nobody is ever counted or turned away: the simultaneous-editor
 * capacity is a design and test target, not a limit (see MAX_CONCURRENT_EDITORS).
 */

import { isValidBoardId } from '../shared/board-id.js';
import { BoardRoom } from './board-room.js';
import { testHookOf } from './test-hooks.js';

export interface Env {
  /** The board rooms: one Durable Object per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not a room. */
  ASSETS: Fetcher;
  /**
   * `"1"` in the e2e wrangler environment only. It turns the routes in
   * `test-hooks.ts` on; it is never set in `wrangler.jsonc`, so a deployment built
   * from this repository's production config does not have them.
   */
  TEST_HOOKS?: string;
}

/** The prefix of the live-connection route. */
const ROOM_PREFIX = '/api/rooms/';

/** The board id in `/api/rooms/:boardId`, or `''` for `/api/rooms` itself. */
const boardIdOf = (pathname: string): string => pathname.slice(ROOM_PREFIX.length);

const isRoomPath = (pathname: string): boolean =>
  pathname === '/api/rooms' || pathname.startsWith(ROOM_PREFIX);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // The test routes belong to a board's object, so they go to the same object
    // the board's socket goes to — which is the whole point of them.
    const hook = testHookOf(pathname);
    if (hook !== undefined) {
      // The gate is here as well as in the object: this one is what a deployment built
      // from `wrangler.jsonc` hits, because that file does not set the variable. The
      // object has its own copy for a request that reaches it some other way.
      if (env.TEST_HOOKS !== '1') return new Response('not found', { status: 404 });
      if (!isValidBoardId(hook.boardId)) return new Response('invalid board id', { status: 400 });
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook.boardId)).fetch(request);
    }

    if (!isRoomPath(pathname)) {
      // The board page, the SPA fallback for `/b/<id>` and every asset.
      return env.ASSETS.fetch(request);
    }

    const boardId = boardIdOf(pathname);
    if (!isValidBoardId(boardId)) {
      // An id that is not 22 base64url characters is not a board: say so, and
      // never create a room for it.
      return new Response('invalid board id', { status: 400 });
    }
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket upgrade', { status: 426 });
    }

    // One object per board id: the isolation between boards is this call.
    const roomId = env.BOARD_ROOM.idFromName(boardId);
    return env.BOARD_ROOM.get(roomId).fetch(request);
  },
};

// The Durable Object class has to be exported from the entry point for the
// runtime to bind it.
export { BoardRoom };
