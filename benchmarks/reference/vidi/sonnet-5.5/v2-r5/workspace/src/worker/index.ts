import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard } from './create-board';
import { handleServe, handleUpload } from './assets';
import { handleTestHook } from './test-hooks';

export interface Env { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher; ASSETS_BUCKET: R2Bucket; TEST_HOOKS?: string }

const ROOM_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const BOARD_PREFIX = '/api/boards/';
const ASSET_PREFIX = '/api/assets/';
const UPLOAD_ROUTE = /^\/api\/boards\/([^/]+)\/assets$/;

const json = (body: unknown, status: number) => Response.json(body, { status });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const boardId = url.pathname.slice(ROOM_PREFIX.length);
      if (!isValidBoardId(boardId)) return new Response('Not Found', { status: 404 });
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Upgrade Required', { status: 426 });
      }
      return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
    }
    if (url.pathname === BOARDS_PATH) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const created = await createBoard(env);
      return created.ok ? json({ id: created.id }, 201) : json({ error: created.reason }, 500);
    }
    const upload = UPLOAD_ROUTE.exec(url.pathname);
    if (upload) {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return handleUpload(req, env, upload[1]);
    }
    if (url.pathname.startsWith(ASSET_PREFIX)) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      return handleServe(env, url.pathname.slice(ASSET_PREFIX.length));
    }
    if (url.pathname.startsWith(BOARD_PREFIX)) {
      if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const boardId = url.pathname.slice(BOARD_PREFIX.length);
      if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);
      try {
        const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).exists();
        return exists ? json({ id: boardId }, 200) : json({ error: 'not_found' }, 404);
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }
    if (url.pathname.startsWith('/__test/')) {
      const hooked = await handleTestHook(req, env);
      if (hooked) return hooked;
    }
    return env.ASSETS.fetch(req);
  },
};

export { BoardRoom } from './board-room';
