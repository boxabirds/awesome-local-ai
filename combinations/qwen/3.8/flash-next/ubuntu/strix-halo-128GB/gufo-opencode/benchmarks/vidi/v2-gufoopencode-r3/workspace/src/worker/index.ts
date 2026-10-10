import { isValidBoardId } from '../shared/board-id';
import { createBoard } from './create-board';
import { BoardRoom } from './board-room';
import { handleTestHook } from './test-hooks';
import { handleServe, handleUpload } from './assets';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  // Enables the /__test/boards/:id/* corruption hooks. Set only in the e2e
  // wrangler environment, never in production config.
  TEST_HOOKS?: string;
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const BOARD_PATH = /^\/api\/boards\/([^/]+)$/;
const BOARD_ASSETS_PATH = /^\/api\/boards\/([^/]+)\/assets$/;
const ASSET_PATH = /^\/api\/assets\/([^/]+)\/([^/]+)$/;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }) + '\n', {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

// /api/boards creates a board (story 5, POST) and checks existence (GET).
// /api/rooms/:boardId upgrades to the board's BoardRoom Durable Object;
// /__test/* routes exist only when TEST_HOOKS=1 (e2e); everything else is
// served from static assets (SPA fallback).
// idFromName(boardId) gives every board its own object, so boards stay
// separate (live.isolation). No participant counting: the capacity setting
// is soft, over-capacity joiners are never refused (live.over_capacity).
// Malformed ids are validated BEFORE touching the namespace, so they never
// instantiate a Durable Object (TC-07). Unknown boards get 404, never a
// blank board (share.not_found).
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const testHook = await handleTestHook(request, env, url);
    if (testHook !== null) return testHook;

    if (url.pathname === '/api/boards') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed\n', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }
      const result = await createBoard(env);
      if (!result.ok) return jsonError('create_failed', 500);
      return new Response(JSON.stringify({ id: result.id }) + '\n', {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    }

    const boardAssetsMatch = BOARD_ASSETS_PATH.exec(url.pathname);
    if (boardAssetsMatch !== null) {
      if (request.method !== 'POST') {
        return new Response('Method not allowed\n', {
          status: 405,
          headers: { Allow: 'POST' }
        });
      }
      return handleUpload(request, env, boardAssetsMatch[1]);
    }

    const assetMatch = ASSET_PATH.exec(url.pathname);
    if (assetMatch !== null) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed\n', {
          status: 405,
          headers: { Allow: 'GET, HEAD' }
        });
      }
      // Key checked as a whole; percent-encoded dots never decode to
      // traversal here because the raw path segments are matched verbatim.
      return handleServe(env, `${assetMatch[1]}/${assetMatch[2]}`);
    }

    const boardMatch = BOARD_PATH.exec(url.pathname);
    if (boardMatch !== null) {
      if (request.method !== 'GET') {
        return new Response('Method not allowed\n', {
          status: 405,
          headers: { Allow: 'GET' }
        });
      }
      const boardId = boardMatch[1];
      // Malformed ids return not_found with no distinction, so nothing is
      // leaked and no object is instantiated (TC-07).
      if (!isValidBoardId(boardId)) return jsonError('not_found', 404);
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      const exists = await stub.exists();
      if (!exists) return jsonError('not_found', 404);
      return new Response(JSON.stringify({ id: boardId }) + '\n', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    const match = ROOM_PATH.exec(url.pathname);
    if (match !== null) {
      const boardId = match[1];
      if (!isValidBoardId(boardId)) {
        // Story 5: a malformed room id is indistinguishable from an unknown
        // board — 404, never a blank board, and no object created.
        return jsonError('not_found', 404);
      }
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required\n', { status: 426 });
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export { BoardRoom };
