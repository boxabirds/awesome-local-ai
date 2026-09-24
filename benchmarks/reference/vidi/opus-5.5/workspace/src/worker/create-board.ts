/**
 * Board creation (story 5): a visitor-keyed rate limit, then a fresh 128-bit id whose Durable
 * Object is initialised over RPC. An id that already belongs to a board (a collision, or a
 * legacy board) is never handed out; another id is tried, up to CREATE_ID_MAX_ATTEMPTS.
 */
import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

/** The part of the Workers rate-limit binding used here (tests may pass a fake). */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'rate_limited' | 'create_failed' };

export type InitializeResult = 'created' | 'exists';

/**
 * The bindings createBoard uses, declared structurally so this module (and its unit tests)
 * type-check without the Workers runtime types; the Worker's Env satisfies it.
 */
export interface CreateBoardEnv<Id = unknown> {
  BOARD_CREATE_LIMITER: Limiter;
  BOARD_ROOM: { idFromName(name: string): Id; get(id: Id): { initialize(): Promise<InitializeResult> } };
}

/**
 * Tries ids from `generate` until `tryInitialize` reports one as newly created. Returns
 * `{ ok: false }` after `maxAttempts` collisions. Errors from `tryInitialize` propagate.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<InitializeResult>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generate();
    if ((await tryInitialize(id)) === 'created') return { ok: true, id };
  }
  return { ok: false };
}

/** Seams for integration tests (collision and RPC-failure cases); production passes none. */
export interface CreateBoardDeps {
  generate?: () => string;
  initialize?: (id: string) => Promise<InitializeResult>;
  limiter?: Limiter;
}

export async function createBoard<Id>(env: CreateBoardEnv<Id>, visitorKey: string, deps: CreateBoardDeps = {}): Promise<CreateResult> {
  const limiter = deps.limiter ?? env.BOARD_CREATE_LIMITER;
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };

  const initialize =
    deps.initialize ?? ((id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());
  try {
    const result = await createWithRetries(deps.generate ?? newBoardId, initialize);
    if (result.ok) return result;
    console.error(JSON.stringify({ event: 'create-board.collisions-exhausted' }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'create-board.initialize-failed', error: String(error) }));
  }
  return { ok: false, reason: 'create_failed' };
}
