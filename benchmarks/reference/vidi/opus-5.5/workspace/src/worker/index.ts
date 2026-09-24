/**
 * Worker entry.
 *
 *   POST /api/boards          create a board (rate-limited per visitor)   201 {id} | 429 | 500
 *   GET  /api/boards/:id      does this board exist?                      200 {id} | 404
 *   GET  /api/rooms/:id       WebSocket upgrade to the board's BoardRoom  101 | 404 | 426
 *
 * Everything else is served from the static client assets (SPA fallback). Malformed ids are
 * rejected before any Durable Object is addressed, so junk ids never create an instance.
 */
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import { createBoard, type Limiter } from './create-board';
import { handleTestHook } from './test-hooks';

export { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Workers rate limiter: BOARD_CREATE_LIMIT creations per BOARD_CREATE_PERIOD_SECONDS per visitor. */
  BOARD_CREATE_LIMITER: Limiter;
  /** '1' only in e2e test servers: enables the routes in test-hooks.ts. Never set in production. */
  TEST_HOOKS?: string;
}

const ROOMS_PREFIX = '/api/rooms/';
const BOARDS_PATH = '/api/boards';
const BOARDS_PREFIX = `${BOARDS_PATH}/`;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_UPGRADE_REQUIRED = 426;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_ERROR = 500;
/** Rate-limit key when the platform gives no client address (local tools only). */
const UNKNOWN_VISITOR = 'unknown';

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: HTTP_NOT_FOUND });
}

function methodNotAllowed(allow: string): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: HTTP_METHOD_NOT_ALLOWED, headers: { Allow: allow } });
}

function room(env: Env, boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

async function handleCreate(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed('POST');
  const visitor = req.headers.get('CF-Connecting-IP') ?? UNKNOWN_VISITOR;
  const result = await createBoard(env, visitor);
  if (result.ok) return Response.json({ id: result.id }, { status: HTTP_CREATED });
  if (result.reason === 'rate_limited') {
    return Response.json({ error: 'rate_limited' }, { status: HTTP_TOO_MANY_REQUESTS });
  }
  return Response.json({ error: 'create_failed' }, { status: HTTP_INTERNAL_ERROR });
}

async function handleCheck(req: Request, env: Env, boardId: string): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
  // Unknown and malformed ids get the same answer: nothing is revealed either way.
  if (!isValidBoardId(boardId)) return notFound();
  if (!(await room(env, boardId).exists())) return notFound();
  return Response.json({ id: boardId }, { status: HTTP_OK });
}

async function handleRoom(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return new Response('Board not found', { status: HTTP_NOT_FOUND });
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade', {
      status: HTTP_UPGRADE_REQUIRED,
      headers: { Upgrade: 'websocket' },
    });
  }
  // One object per board (isolation). The room answers 404 for a board that does not exist.
  // No participant counting: capacity is a soft target.
  return room(env, boardId).fetch(req);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === BOARDS_PATH) return handleCreate(req, env);
    if (pathname.startsWith(BOARDS_PREFIX)) return handleCheck(req, env, pathname.slice(BOARDS_PREFIX.length));
    if (pathname.startsWith(ROOMS_PREFIX)) return handleRoom(req, env, pathname.slice(ROOMS_PREFIX.length));
    return (await handleTestHook(req, env)) ?? env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
