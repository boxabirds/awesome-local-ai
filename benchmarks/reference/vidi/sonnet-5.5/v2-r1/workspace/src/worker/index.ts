import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  TEST_HOOKS?: string;
}

const BOARDS_ROUTE = /^\/api\/boards(?:\/([^/]*))?$/;
const ROOM_ROUTE = /^\/api\/rooms\/([^/]*)$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const methodNotAllowed = (allow: string) => new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const hook = await handleTestHook(req, env);
    if (hook) return hook;
    const path = new URL(req.url).pathname;

    const boards = BOARDS_ROUTE.exec(path);
    if (boards) {
      const id = boards[1];
      if (id === undefined) {
        if (req.method !== 'POST') return methodNotAllowed('POST');
        const created = await createBoard(env);
        return created.ok ? json({ id: created.id }, 201) : json({ error: created.reason }, 500);
      }
      if (req.method !== 'GET') return methodNotAllowed('GET');
      // Unknown and malformed ids look the same; malformed ids never reach a Durable Object.
      if (!isValidBoardId(id) || !(await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).exists())) {
        return json({ error: 'not_found' }, 404);
      }
      return json({ id }, 200);
    }

    const match = ROOM_ROUTE.exec(path);
    if (!match) return env.ASSETS.fetch(req);
    if (!isValidBoardId(match[1])) return new Response('Not Found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1])).fetch(req);
  },
};

export { BoardRoom } from './board-room';
