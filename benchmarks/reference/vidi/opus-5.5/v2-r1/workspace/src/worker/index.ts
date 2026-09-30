import { isValidBoardId } from '../shared/board-id';
import { handleServe, handleUpload } from './assets';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Uploaded images (story 12). */
  ASSETS_BUCKET: R2Bucket;
  /** '1' only in the e2e `wrangler dev` (enables src/worker/test-hooks.ts routes). */
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/(.*)$/;
const BOARDS_PATH = /^\/api\/boards\/?$/;
const BOARD_PATH = /^\/api\/boards\/(.+)$/;
const BOARD_ASSETS_PATH = /^\/api\/boards\/([^/]+)\/assets\/?$/;
const ASSET_PATH = /^\/api\/assets\/(.*)$/;

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const notFound = () => json({ error: 'not_found' }, 404);

/** The decoded board id from a path segment, or null when it is not a valid id. */
function boardIdFrom(segment: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return isValidBoardId(id) ? id : null;
}

/** Story 12: image upload (POST /api/boards/:id/assets) and serving (GET /api/assets/:key). */
async function handleAssets(req: Request, url: URL, env: Env): Promise<Response | null> {
  const upload = BOARD_ASSETS_PATH.exec(url.pathname);
  if (upload) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const boardId = boardIdFrom(upload[1]);
    return boardId ? handleUpload(req, env, boardId) : notFound();
  }
  const serve = ASSET_PATH.exec(url.pathname);
  if (!serve) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  let key: string;
  try {
    key = decodeURIComponent(serve[1]);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  return handleServe(env, key);
}

async function handleBoards(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (BOARDS_PATH.test(url.pathname)) {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const result = await createBoard(env);
    return result.ok ? json({ id: result.id }, 201) : json({ error: result.reason }, 500);
  }
  const match = BOARD_PATH.exec(url.pathname);
  if (!match) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
  }
  // Malformed ids never reach the namespace; unknown and malformed look the same (share.not_found).
  const boardId = boardIdFrom(match[1]);
  if (!boardId) return notFound();
  const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
  return exists ? json({ id: boardId }, 200) : notFound();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const assets = await handleAssets(req, url, env);
    if (assets) return assets;
    const boards = await handleBoards(req, url, env);
    if (boards) return boards;
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) {
      // Any other API address (e.g. `/api/assets/../x`, normalised to `/api/x`) is not found,
      // never the app page.
      if (url.pathname.startsWith('/api/')) return notFound();
      return (await handleTestHook(req, url, env)) ?? env.ASSETS.fetch(req);
    }
    const boardId = boardIdFrom(match[1]);
    if (!boardId) return new Response('Board not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    // One room object per board: isolation. No participant counting: soft capacity.
    // The room answers 404 for a board that does not exist (connecting never creates one).
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
} satisfies ExportedHandler<Env>;
