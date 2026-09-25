/**
 * Board creation (anchor: share.board_api). A visitor may create BOARD_CREATE_LIMIT boards
 * per BOARD_CREATE_PERIOD_SECONDS (BOARD_CREATE_LIMITER binding). Each board gets a fresh
 * 128-bit `newBoardId()`; the id's BoardRoom is initialised over RPC, and an id that already
 * belongs to a board is never handed out again (share.unique): the next id is tried instead.
 * Also answers the board HTTP routes (`handleBoardsRequest`).
 */
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import type { BoardRoom } from './board-room';
import type { Env } from './index';

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'rate_limited' | 'create_failed' };

/** Tries up to `maxAttempts` generated ids; the first one `tryInitialize` reports as created wins. */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    if ((await tryInitialize(id)) === 'created') return { ok: true, id };
    console.warn(JSON.stringify({ event: 'create_board.id_collision', attempt: attempt + 1 }));
  }
  return { ok: false };
}

/** Replaceable pieces, for integration tests only (id collisions and RPC failures cannot be forced). */
export interface CreateBoardDeps {
  generate?: () => string;
  initialize?: (id: string) => Promise<'created' | 'exists'>;
}

export async function createBoard(env: Env, visitorKey: string, deps: CreateBoardDeps = {}): Promise<CreateResult> {
  const { success } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };
  const generate = deps.generate ?? newBoardId;
  const initialize =
    deps.initialize ?? ((id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());
  try {
    const result = await createWithRetries(generate, initialize);
    return result.ok ? result : { ok: false, reason: 'create_failed' };
  } catch (err) {
    console.error(JSON.stringify({ event: 'create_board.failed', error: err instanceof Error ? err.message : String(err) }));
    return { ok: false, reason: 'create_failed' };
  }
}

const BOARDS_PATH = '/api/boards';
const BOARDS_PREFIX = '/api/boards/';
const CREATED = 201;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const TOO_MANY_REQUESTS = 429;
const INTERNAL_ERROR = 500;
/**
 * E2E runs create many boards from one address; with TEST_HOOKS on, this header names the
 * simulated visitor instead of CF-Connecting-IP. Ignored in production.
 */
export const TEST_VISITOR_HEADER = 'X-Test-Visitor';

const notFound = () => Response.json({ error: 'not_found' }, { status: NOT_FOUND });

function visitorKey(req: Request, env: Env): string {
  const override = env.TEST_HOOKS === '1' ? req.headers.get(TEST_VISITOR_HEADER) : null;
  return override ?? req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function room(env: Env, boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/**
 * `POST /api/boards` and `GET /api/boards/:id` (routed here by src/worker/index.ts).
 * Malformed ids are 404 before the namespace is touched; `deps` is for integration tests only.
 */
export async function handleBoardsRequest(req: Request, env: Env, deps: CreateBoardDeps = {}): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === BOARDS_PATH || pathname === `${BOARDS_PATH}/`) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: METHOD_NOT_ALLOWED, headers: { Allow: 'POST' } });
    const result = await createBoard(env, visitorKey(req, env), deps);
    if (result.ok) return Response.json({ id: result.id }, { status: CREATED });
    return Response.json(
      { error: result.reason },
      { status: result.reason === 'rate_limited' ? TOO_MANY_REQUESTS : INTERNAL_ERROR },
    );
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: METHOD_NOT_ALLOWED, headers: { Allow: 'GET' } });
  }
  const boardId = pathname.slice(BOARDS_PREFIX.length);
  if (!isValidBoardId(boardId)) return notFound();
  if (!(await room(env, boardId).exists())) return notFound();
  return Response.json({ id: boardId });
}
