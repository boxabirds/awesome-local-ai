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

export { BoardRoom };

/** The bindings this Worker needs (declared in `wrangler.jsonc`). */
export interface Env {
  /** One {@link BoardRoom} per board: the room holds that board's live document. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not the room API. */
  ASSETS: Fetcher;
}

const ROOM_PREFIX = '/api/rooms/';
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

    if (!url.pathname.startsWith(API_PREFIX)) {
      // the client, and the SPA fallback for `/b/<boardId>` and friends
      return env.ASSETS.fetch(request);
    }

    let boardId: string | null;
    try {
      boardId = boardIdFromPath(url.pathname);
    } catch {
      return statusResponse(400, 'Bad Request');
    }
    if (boardId === null) return statusResponse(404, 'Not Found');

    // An address is the only thing gating a board, so a malformed one never reaches a room
    // (and never creates a Durable Object instance).
    if (!isValidBoardId(boardId)) return statusResponse(400, 'Bad Request');
    if (!isWebSocketUpgrade(request)) return statusResponse(426, 'Upgrade Required');

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};
