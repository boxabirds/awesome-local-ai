/**
 * The Worker entry point: the only thing between an HTTP request and a board.
 *
 * Routing (see the story 3 design):
 *
 * - `GET /api/rooms/:boardId` with `Upgrade: websocket` -> that board's {@link BoardRoom}
 * - `GET /api/rooms/:boardId` with an id that is not a board address -> `400`
 * - `GET /api/rooms/:boardId` without the upgrade header -> `426 Upgrade Required`
 * - anything else -> the static assets, with the SPA fallback serving `index.html` for
 *   client-side routes such as `/b/<boardId>`
 *
 * One thing is routed before all of that, and only when `TEST_HOOKS=1`: the storage hooks at
 * `/__test/boards/:boardId/{corrupt-snapshot,repair}` (see `test-hooks.ts`). With the switch off -
 * which is every config but the e2e dev server's - those paths are not `/api/...` either, so they
 * land on the assets and get the SPA's `index.html`, exactly like any unknown address.
 *
 * Isolation (`live.isolation`): `idFromName(boardId)` gives every board its own Durable
 * Object, so a room only ever holds one board's document and only broadcasts to that
 * board's sockets.
 *
 * Capacity (`live.over_capacity`): nobody is counted anywhere, so a 6th (or 50th) person
 * on a board is connected exactly like the first. `MAX_CONCURRENT_EDITORS` is a design and
 * test target, never a limit enforced here.
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { deliverStorageHook, parseStorageHook, testHooksEnabled } from './test-hooks';

export { BoardRoom };

/** The bindings this Worker needs (declared in `wrangler.jsonc`). */
export interface Env {
  /** One {@link BoardRoom} per board: the room holds that board's live document. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not the room API. */
  ASSETS: Fetcher;
  /** `'1'` turns on the test-only storage hooks. Set by the e2e dev servers, never in production. */
  TEST_HOOKS?: string;
}

const ROOM_PREFIX = '/api/rooms/';
const BOARDS_PREFIX = '/api/boards';
const API_PREFIX = '/api/';

/** `true` when the request asks to be switched to a WebSocket. */
function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket';
}

/** Plain-text response with the given status (the room API has no body to speak of). */
function statusResponse(status: number, reason: string): Response {
  return new Response(`${status} ${reason}\n`, { status });
}

/**
 * The board id a room request addresses, or `null` when the path is not a room request.
 * Throws `RangeError` for a path with percent-encoding that cannot be decoded.
 */
function boardIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(ROOM_PREFIX)) return null;
  const id = pathname.slice(ROOM_PREFIX.length);
  // exactly one segment: `/api/rooms/` and `/api/rooms/a/b` address no board
  if (id === '' || id.includes('/')) return null;
  return decodeURIComponent(id);
}

export default {
  // `ctx` is always passed by the runtime; optional so a test can call the handler directly.
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Switched off unless the environment says so, which production config never does: the hooks
    // let an end-to-end test make a board unreadable and readable again while the server runs.
    if (testHooksEnabled(env)) {
      const hook = parseStorageHook(url.pathname);
      if (hook !== null) {
        if (!isValidBoardId(hook.boardId)) return statusResponse(400, 'Bad Request');
        return deliverStorageHook(env, hook.boardId, hook.action);
      }
    }

    if (!url.pathname.startsWith(API_PREFIX)) {
      // the client, and the SPA fallback for `/b/<boardId>` and friends
      return env.ASSETS.fetch(request);
    }

    // POST /api/boards – create a new board
    if (url.pathname === BOARDS_PREFIX && request.method === 'POST') {
      const result = await createBoard(env);
      if (result.ok) {
        return Response.json({ id: result.id }, { status: 201 });
      }
      return Response.json({ error: 'create_failed' }, { status: 500 });
    }

    // Other methods on /api/boards (exact match, no trailing slash path segment)
    if (url.pathname === BOARDS_PREFIX) {
      return statusResponse(405, 'Method Not Allowed');
    }

    // GET /api/boards/:id – check board existence
    if (url.pathname.startsWith(BOARDS_PREFIX + '/') && request.method === 'GET') {
      const id = url.pathname.slice(BOARDS_PREFIX.length + 1);
      // Reject malformed ids without touching the namespace
      if (!id || id.includes('/') || !isValidBoardId(decodeURIComponent(id))) {
        return Response.json({ error: 'not_found' }, { status: 404 });
      }
      const boardId = decodeURIComponent(id);
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const existsResult = await stub.exists();
      if (existsResult) {
        return Response.json({ id: boardId }, { status: 200 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }

    let boardId: string | null;
    try {
      boardId = boardIdFromPath(url.pathname);
    } catch {
      return statusResponse(400, 'Bad Request');
    }
    if (boardId === null) return statusResponse(404, 'Not Found');

    // An address is the only thing gating a board, so a malformed one never reaches a room
    // (and never creates a Durable Object instance). 404 rather than 400: do not distinguish
    // unknown from malformed.
    if (!isValidBoardId(boardId)) return statusResponse(404, 'Not Found');
    if (!isWebSocketUpgrade(request)) return statusResponse(426, 'Upgrade Required');

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};
