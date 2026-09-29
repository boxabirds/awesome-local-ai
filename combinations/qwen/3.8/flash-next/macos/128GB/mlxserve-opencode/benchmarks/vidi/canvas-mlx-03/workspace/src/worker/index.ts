// Worker entry: route WebSocket upgrades for /api/rooms/:boardId to that board's
// BoardRoom Durable Object, and everything else to the static assets binding.
// See design "Worker entry and routing".

import { isValidBoardId } from '../shared/board-id.ts';
import { BoardRoom } from './board-room.ts';

export { BoardRoom } from './board-room.ts';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROOM_PATH.exec(url.pathname);

    if (match) {
      const boardId = match[1];
      // Validate before touching the namespace so an invalid id can never
      // instantiate a Durable Object (TC-04).
      if (!isValidBoardId(boardId)) {
        return new Response('invalid board id', { status: 400 });
      }
      const upgrade = (request.headers.get('Upgrade') ?? '').toLowerCase();
      if (upgrade !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      // idFromName(boardId) gives each board its own object — this is what keeps
      // boards isolated (live.isolation). There is deliberately no participant
      // count check: an over-capacity joiner is never refused (live.over_capacity).
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
