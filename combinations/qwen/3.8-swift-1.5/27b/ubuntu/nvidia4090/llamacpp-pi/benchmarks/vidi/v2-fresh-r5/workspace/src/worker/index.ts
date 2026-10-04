/**
 * Worker entry: routes `/api/rooms/:boardId` WebSocket upgrades to that
 * board's BoardRoom Durable Object and everything else to the static assets.
 *
 * Boards stay separate (live.isolation): `idFromName(boardId)` maps every
 * board to its own object instance, which holds only that board's Y.Doc.
 * There is no participant counting: a 6th or later joiner is accepted like
 * anyone else (live.over_capacity; capacity is a soft design target).
 */
import { isValidBoardId } from '../shared/board-id';
import { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOMS_PREFIX = '/api/rooms/';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);

      // Validate before touching the namespace: an invalid id must not
      // create (or even look up) an object instance.
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }

      const upgrade = (req.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom } from './board-room';
