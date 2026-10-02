/**
 * The vidi6 Worker: the front door of the service.
 *
 * Two kinds of request arrive:
 *
 * - `GET /api/rooms/:boardId` with a WebSocket upgrade — the connection of one
 *   person on one board. The board address decides which `BoardRoom` object the
 *   request goes to, so people on different boards are in different objects and a
 *   change on one board can never be seen on another (`live.isolation`).
 * - everything else — the HTML, the script, the styles — from the static assets.
 *
 * Nothing here counts people. A board that already has MAX_CONCURRENT_EDITORS
 * (5) people on it accepts the next person like anybody else; that setting is a
 * design and test target, never a limit (`live.over_capacity`).
 */
import type { BoardRoom } from './board-room';
import { isValidBoardId } from '../shared/board-id';

/** The room a connection is routed to must be exported from the entry point. */
export { BoardRoom } from './board-room';

/** Bindings, as declared in `wrangler.jsonc`. */
export interface Env {
  /** Durable Object namespace: one `BoardRoom` per board address. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client. */
  ASSETS: Fetcher;
}

/** Every connection to a board starts here. */
const ROOM_PATH = '/api/rooms/';

/**
 * True when the request asks for a WebSocket upgrade.
 *
 * The header is a list, so `Upgrade: websocket` and `Upgrade: WebSocket, foo`
 * both count; a request without it is an ordinary `GET`, which is not a question
 * a room can answer.
 */
function wantsWebSocketUpgrade(request: Request): boolean {
  const upgrade = request.headers.get('Upgrade') ?? '';
  return upgrade.split(',').some((part) => part.trim().toLowerCase() === 'websocket');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== ROOM_PATH && !url.pathname.startsWith(ROOM_PATH)) {
      return env.ASSETS.fetch(request);
    }

    // The address is one path segment and nothing more; a query string is not
    // part of it, and `%2F` must not become a second segment.
    const segment = decodeURIComponent(url.pathname.slice(ROOM_PATH.length));
    if (!isValidBoardId(segment)) {
      return new Response('that is not a board address', { status: 400 });
    }
    if (!wantsWebSocketUpgrade(request)) {
      return new Response('a board needs a websocket connection', { status: 426 });
    }

    // `idFromName` gives every board address its own object, for good: the same
    // address always lands in the same room, and different addresses never do.
    const id = env.BOARD_ROOM.idFromName(segment);
    return env.BOARD_ROOM.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
