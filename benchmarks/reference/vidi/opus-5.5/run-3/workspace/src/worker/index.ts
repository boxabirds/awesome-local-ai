// Worker entry:
//   POST /api/boards             create a board (rate limited per visitor)
//   GET  /api/boards/:boardId    does this board exist?
//   GET  /api/rooms/:boardId     WebSocket to that board's BoardRoom (existing boards only)
//   POST /api/boards/:boardId/assets        upload an image to an existing board (story 12, assets.ts)
//   GET  /api/assets/:boardId/:assetId      a stored image
// Everything else is the static client (and, only when TEST_HOOKS is enabled, /__test/* storage hooks for the
// e2e suite). Malformed ids are answered 404 before any Durable Object is touched.
import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleServe, handleUpload } from './assets';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  BOARD_CREATE_LIMITER: RateLimit;
  ASSET_UPLOAD_LIMITER: RateLimit;
  ASSETS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** '1' enables the test-only storage hooks (e2e only; never set in wrangler.jsonc). */
  TEST_HOOKS?: string;
}

/** Test seams (integration tests only): force id collisions. */
export interface Deps {
  generateId?: () => string;
}

const BOARDS_PATH = /^\/api\/boards\/?$/;
const BOARD_PATH = /^\/api\/boards\/([^/]*)$/;
const ROOM_PATH = /^\/api\/rooms\/([^/]*)$/;
const UPLOAD_PATH = /^\/api\/boards\/([^/]*)\/assets$/;
const ASSET_PATH = /^\/api\/assets\/(.*)$/;

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const notFound = () => json({ error: 'not_found' }, 404);

export async function handleRequest(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/__test/')) return (await handleTestHook(req, env)) ?? env.ASSETS.fetch(req);

  if (BOARDS_PATH.test(url.pathname)) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const visitor = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    const result = await createBoard(env, visitor, deps.generateId ?? newBoardId);
    if (result.ok) return json({ id: result.id }, 201);
    return result.reason === 'rate_limited' ? json({ error: 'rate_limited' }, 429) : json({ error: 'create_failed' }, 500);
  }

  const upload = UPLOAD_PATH.exec(url.pathname);
  if (upload) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const boardId = decodeURIComponentSafe(upload[1]);
    return boardId === null ? notFound() : handleUpload(req, env, boardId);
  }

  const asset = ASSET_PATH.exec(url.pathname);
  if (asset) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const key = decodeURIComponentSafe(asset[1]);
    return key === null ? new Response('Not found', { status: 404 }) : handleServe(env, key);
  }

  const board = BOARD_PATH.exec(url.pathname);
  if (board) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const boardId = decodeURIComponentSafe(board[1]);
    if (boardId === null || !isValidBoardId(boardId)) return notFound();
    const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
    return exists ? json({ id: boardId }, 200) : notFound();
  }

  const room = ROOM_PATH.exec(url.pathname);
  if (!room) return env.ASSETS.fetch(req);
  const boardId = decodeURIComponentSafe(room[1]);
  if (boardId === null || !isValidBoardId(boardId)) return new Response('Board not found', { status: 404 });
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
  }
  // One object per board keeps boards apart. It answers 404 for boards that do not exist.
  // No participant limit: capacity is a soft design target.
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
}

export default {
  fetch: (req: Request, env: Env) => handleRequest(req, env),
} satisfies ExportedHandler<Env>;

function decodeURIComponentSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
