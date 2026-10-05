import { isValidBoardId } from '../shared/board-id';
import { BoardRoom, type BoardRoomStub } from './board-room';
import { createBoard } from './create-board';
import { handleUpload, handleServe } from './assets';
import { handleTestHook, recordNamespaceGet } from './test-hooks';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Story 12: board image assets. */
  ASSETS_BUCKET: R2Bucket;
  /** TEST-ONLY: set to "1" (wrangler vars) to enable the /__test/* routes. */
  TEST_HOOKS?: string;
}

const ASSETS_UPLOAD_PREFIX = '/api/boards/';
const ASSETS_SERVE_PREFIX = '/api/assets/';

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PREFIX = '/api/boards';
const BOARDS_ITEM_PREFIX = '/api/boards/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Gets a board's Durable Object stub, counting the namespace get (TC-07). */
function boardStub(env: Env, id: string): BoardRoomStub {
  recordNamespaceGet();
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)) as BoardRoomStub;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // TEST-ONLY routes (only when env.TEST_HOOKS === '1').
    const hook = await handleTestHook(req, env);
    if (hook) return hook;

    // POST /api/boards → create a board; any other method → 405.
    if (url.pathname === BOARDS_PREFIX) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const result = await createBoard(env);
      return result.ok
        ? json({ id: result.id }, 201)
        : json({ error: 'create_failed' }, 500);
    }

    // Story 12: POST /api/boards/:boardId/assets → upload an image asset.
    // (Checked before the generic /api/boards/:id route.)
    if (url.pathname.startsWith(ASSETS_UPLOAD_PREFIX) && url.pathname.endsWith('/assets')) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const id = url.pathname.slice(ASSETS_UPLOAD_PREFIX.length, -'/assets'.length);
      return handleUpload(req, env, id);
    }

    // Story 12: GET /api/assets/:boardId/:assetId → serve a stored image.
    if (url.pathname.startsWith(ASSETS_SERVE_PREFIX)) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const key = url.pathname.slice(ASSETS_SERVE_PREFIX.length);
      return handleServe(env, key);
    }

    // GET /api/boards/:id → existence check. Unknown AND malformed ids both
    // get 404 (no distinction, nothing leaked); malformed ids never reach the
    // Durable Object namespace (TC-07).
    if (url.pathname.startsWith(BOARDS_ITEM_PREFIX)) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const id = url.pathname.slice(BOARDS_ITEM_PREFIX.length);
      if (!isValidBoardId(id)) return json({ error: 'not_found' }, 404);
      const stub = boardStub(env, id);
      const exists = await stub.exists();
      return exists ? json({ id }) : json({ error: 'not_found' }, 404);
    }

    // Route /api/rooms/:boardId to the BoardRoom Durable Object
    if (url.pathname.startsWith(ROOMS_PREFIX)) {
      const boardId = url.pathname.slice(ROOMS_PREFIX.length);

      // Validate board id: unknown/malformed ids get 404 (story 3's 400).
      if (!isValidBoardId(boardId)) {
        return json({ error: 'not_found' }, 404);
      }

      // Require WebSocket upgrade
      const upgrade = req.headers.get('upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }

      // Forward to the Durable Object (it rejects non-existent boards with 404).
      const stub = boardStub(env, boardId);
      return stub.fetch(req);
    }

    // Everything else → static assets (SPA fallback)
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

export { BoardRoom };
