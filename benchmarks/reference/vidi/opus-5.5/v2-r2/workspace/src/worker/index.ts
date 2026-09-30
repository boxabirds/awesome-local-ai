import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { routeTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** '1' only in the e2e `wrangler dev` (enables src/worker/test-hooks.ts); never in production. */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/(.*)$/;
const BOARDS_PATH = /^\/api\/boards\/?$/;
const BOARD_PATH = /^\/api\/boards\/(.+)$/;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

const notFound = () => json({ error: 'not_found' }, 404);

function room(env: Env, boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

async function handleBoards(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (BOARDS_PATH.test(pathname)) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const result = await createBoard(env);
    return result.ok ? json({ id: result.id }, 201) : json({ error: result.reason }, 500);
  }
  const match = BOARD_PATH.exec(pathname);
  if (!match) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  const boardId = match[1] ?? '';
  // Malformed ids never reach (or instantiate) a room; same answer as unknown ids.
  if (!isValidBoardId(boardId)) return notFound();
  try {
    return (await room(env, boardId).exists()) ? json({ id: boardId }, 200) : notFound();
  } catch (error) {
    console.error(JSON.stringify({ event: 'board-check-failed', error: String(error) }));
    return json({ error: 'check_failed' }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hook = routeTestHook(request, env);
    if (hook) return hook;
    const boards = await handleBoards(request, env, url.pathname);
    if (boards) return boards;
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);
    const boardId = match[1] ?? '';
    if (!isValidBoardId(boardId)) return new Response('Board not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    // One room object per board keeps boards separate; the room answers 404 for unknown boards.
    // No participant counting: capacity is soft.
    return room(env, boardId).fetch(request);
  },
} satisfies ExportedHandler<Env>;
