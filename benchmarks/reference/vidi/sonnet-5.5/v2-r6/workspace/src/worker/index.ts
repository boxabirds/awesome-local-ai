import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { handleServe, handleUpload } from './assets';
import { createBoard } from './create-board';

export interface Env { BOARD_ROOM: DurableObjectNamespace<BoardRoom>; ASSETS: Fetcher; ASSETS_BUCKET: R2Bucket; TEST_HOOKS?: string }

const ROOM_PATH = /^\/api\/rooms\/([^/]+)$/;
const BOARD_PATH = /^\/api\/boards\/([^/]+)$/;
const UPLOAD_PATH = /^\/api\/boards\/([^/]+)\/assets$/;
const SERVE_PATH = /^\/api\/assets\/([^/]+)\/([^/]+)$/;
const TEST_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|seed-legacy)$/;

const json = (body: unknown, status: number): Response => Response.json(body, { status });
const notFound = (): Response => json({ error: 'not_found' }, 404);

function boardIdOf(raw: string): string | null {
  let id: string;
  try { id = decodeURIComponent(raw); } catch { return null; }
  return isValidBoardId(id) ? id : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (env.TEST_HOOKS === '1' && req.method === 'POST') {
      const hook = TEST_PATH.exec(path);
      if (hook && isValidBoardId(hook[1])) {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(hook[1]));
        return stub.fetch(new Request(`https://room/__test/${hook[2]}`, { method: 'POST', body: req.body }));
      }
    }

    if (path === '/api/boards') {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      const result = await createBoard(env);
      return result.ok ? json({ id: result.id }, 201) : json({ error: result.reason }, 500);
    }

    const upload = UPLOAD_PATH.exec(path);
    if (upload) {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      const id = boardIdOf(upload[1]);
      return id ? handleUpload(req, env, id) : notFound();
    }
    const served = SERVE_PATH.exec(path);
    if (served) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      let key: string;
      try { key = `${decodeURIComponent(served[1])}/${decodeURIComponent(served[2])}`; } catch { return notFound(); }
      return handleServe(env, key);
    }

    const board = BOARD_PATH.exec(path);
    if (board) {
      if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      const id = boardIdOf(board[1]);
      if (!id) return notFound();
      try {
        const exists = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).exists();
        return exists ? json({ id }, 200) : notFound();
      } catch {
        return json({ error: 'unavailable' }, 503);
      }
    }

    const match = ROOM_PATH.exec(path);
    if (!match) return env.ASSETS.fetch(req);
    const boardId = boardIdOf(match[1]);
    if (!boardId) return new Response('Not Found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(req);
  },
};

export { BoardRoom } from './board-room';
