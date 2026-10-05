/**
 * The Worker: everything the product serves.
 *
 * Two kinds of request arrive. A WebSocket to `/api/rooms/<board id>` is a person
 * joining a board; it goes to that board's own room object, which is what keeps
 * one board's changes from ever appearing on another. Everything else is the
 * built client, served from static assets, including `/b/<board id>` — the board
 * address people open — which is the same `index.html` every time because the
 * page decides what to show from its own address.
 */
import { isValidBoardId } from '../shared/board-id';
import type { Env } from './board-room';

export type { Env };
export { BoardRoom } from './board-room';

/** Everything under this path is a board connection, and only ever one segment deep. */
const ROOM_PREFIX = '/api/rooms/';

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const path = new URL(request.url).pathname;
    if (path === '/api/rooms' || path.startsWith(ROOM_PREFIX)) {
      return this.routeBoardConnection(request, env, path);
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * Hand a board connection to its room, or refuse it.
   *
   * A board address is the only thing that grants access to a board in this
   * release, so an address that is not one is refused here, before a room is
   * created for it: the room objects are never told about an id they would have to
   * invent a document for. A request that is not asking to become a WebSocket gets
   * the answer that says what it is missing.
   */
  routeBoardConnection(request: Request, env: Env, path: string): Promise<Response> | Response {
    const boardId = boardIdFromPath(path);
    if (boardId === null || !isValidBoardId(boardId)) {
      return new Response('That is not a board address.', { status: 400 });
    }

    const upgrade = request.headers.get('Upgrade');
    if (upgrade === null || upgrade.toLowerCase() !== 'websocket') {
      return new Response('This board address needs a WebSocket connection.', {
        status: 426,
        headers: { Upgrade: 'websocket' },
      });
    }

    // One object per board address, chosen by that address: people on different
    // boards are in different objects and cannot see each other's changes; people
    // on the same address are in the same one. Nothing here counts them — the
    // product's capacity is a design target, and a sixth person is never refused.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
};

/**
 * The board id in a connection path, or null when the path does not hold exactly
 * one. `%`-escapes are decoded because that is how a browser sends an address it
 * was given, and a path that cannot even be decoded is not an address either.
 */
function boardIdFromPath(path: string): string | null {
  if (!path.startsWith(ROOM_PREFIX)) return null;
  const segment = path.slice(ROOM_PREFIX.length);
  if (segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
