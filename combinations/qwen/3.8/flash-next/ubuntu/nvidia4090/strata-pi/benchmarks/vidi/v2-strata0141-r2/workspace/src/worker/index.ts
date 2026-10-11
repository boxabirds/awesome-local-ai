/**
 * Worker entry (story 3).
 *
 * Two jobs only:
 * - `/api/rooms/:boardId` is the sync WebSocket endpoint. The board id decides
 *   which BoardRoom object the socket lands in, which is what keeps boards
 *   separate (`live.isolation`): a board's document and sockets only ever reach
 *   that board's object.
 * - everything else is the built client, served from static assets.
 *
 * Nothing here counts participants. The simultaneous-editor capacity
 * (MAX_CONCURRENT_EDITORS) is a design and test target, never a gate, so a 6th
 * person is accepted like anyone else (`live.over_capacity`).
 *
 * Only the handler and the Durable Object class are exported: the Workers
 * runtime reads the entry module's exports as handlers.
 */

import { ROOM_ROUTE_PREFIX, boardIdFromPath } from '../shared/room-route';
import { BoardRoom } from './board-room';

export interface Env {
  /** One BoardRoom per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client. */
  ASSETS: Fetcher;
}

/** `Upgrade: websocket`, compared the way HTTP headers are meant to be read. */
function isUpgradeRequest(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(ROOM_ROUTE_PREFIX)) {
      return env.ASSETS.fetch(request);
    }

    // A room path whose id is malformed is answered here: it must never reach
    // the assets binding, and it must never create a Durable Object instance.
    const boardId = boardIdFromPath(pathname);
    if (boardId === null) {
      return new Response('Invalid board id', { status: 400 });
    }

    if (!isUpgradeRequest(request)) {
      return new Response('Upgrade Required', { status: 426 });
    }

    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.fetch(request);
  },
};

export { BoardRoom };
