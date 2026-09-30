import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { routeTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' only in the e2e `wrangler dev` (enables src/worker/test-hooks.ts); never in production. */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/(.*)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hook = routeTestHook(request, env);
    if (hook) return hook;
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);
    const boardId = match[1] ?? '';
    if (!isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // One room object per board keeps boards separate. No participant counting: capacity is soft.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
