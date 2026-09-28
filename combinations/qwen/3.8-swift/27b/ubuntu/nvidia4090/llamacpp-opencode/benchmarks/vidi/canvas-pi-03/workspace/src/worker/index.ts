/**
 * Story 3: Worker entry point.
 *
 * Routes `/api/rooms/:boardId` (with a valid id and an `Upgrade: websocket`
 * header) to the board's BoardRoom Durable Object; everything else to the
 * static assets (single-page-app fallback). Board isolation comes from
 * `idFromName(boardId)` giving each board its own object instance.
 *
 * There is deliberately no participant-counting or connection limit here
 * (live.over_capacity): the capacity is a soft design target, never enforced.
 */
import { isValidBoardId } from 'src/shared/board-id';
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
      if (!isValidBoardId(boardId)) {
        return new Response('Bad Request', { status: 400 });
      }
      const upgrade = (req.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('Upgrade Required', {
          status: 426,
          headers: { Upgrade: 'websocket' },
        });
      }
      const id = env.BOARD_ROOM.idFromName(boardId);
      const stub = env.BOARD_ROOM.get(id);
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
