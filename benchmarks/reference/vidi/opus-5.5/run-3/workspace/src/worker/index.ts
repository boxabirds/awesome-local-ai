// Worker entry: /api/rooms/:boardId goes to that board's BoardRoom; everything else is the static client
// (and, only when TEST_HOOKS is enabled, /__test/* storage hooks for the e2e suite).
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' enables the test-only storage hooks (e2e only; never set in wrangler.jsonc). */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]*)$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/__test/')) return (await handleTestHook(req, env)) ?? env.ASSETS.fetch(req);
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(req);
    const boardId = decodeURIComponentSafe(match[1]);
    if (boardId === null || !isValidBoardId(boardId)) return new Response('Invalid board id', { status: 400 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    // One object per board keeps boards apart. No participant limit: capacity is a soft design target.
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

function decodeURIComponentSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
