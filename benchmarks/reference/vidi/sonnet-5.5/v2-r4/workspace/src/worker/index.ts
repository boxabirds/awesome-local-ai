import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string; // '1' only in the e2e wrangler run
}

const ROOM_PATH = /^\/api\/rooms\/([^/]*)$/;
const BOARD_PATH = /^\/api\/boards\/([^/]*)$/;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = () => json({ error: 'not_found' }, 404);

/** The decoded id, or null when it is malformed (callers answer 404 without touching the namespace). */
function decodeId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return isValidBoardId(id) ? id : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const hook = await handleTestHook(req, env);
    if (hook) return hook;
    const path = new URL(req.url).pathname;

    if (path === '/api/boards') {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      const result = await createBoard(env);
      return result.ok ? json({ id: result.id }, 201) : json({ error: 'create_failed' }, 500);
    }

    const board = BOARD_PATH.exec(path);
    if (board) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      }
      const id = decodeId(board[1]);
      if (!id) return notFound();
      const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).exists();
      return exists ? json({ id }, 200) : notFound();
    }

    const room = ROOM_PATH.exec(path);
    if (!room) return env.ASSETS.fetch(req);
    const id = decodeId(room[1]);
    if (!id) return notFound();
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).fetch(req);
  },
};

export { BoardRoom } from './board-room';
