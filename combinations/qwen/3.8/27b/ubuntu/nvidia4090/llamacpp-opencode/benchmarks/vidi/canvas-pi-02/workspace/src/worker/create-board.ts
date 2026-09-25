/**
 * Board creation (story 5, share.board_api).
 *
 * `createWithRetries` is the pure retry loop: it generates candidate ids
 * and calls `tryInitialize` until one returns 'created' or maxAttempts is
 * exhausted. It is exported separately so unit tests can exercise the retry
 * logic with deterministic generators (TC-01, TC-02).
 *
 * `createBoard` is the full handler: rate-limit check → createWithRetries
 * → CreateResult. The id is 128-bit random (newBoardId), never derived from
 * time, counters, or other boards (share.unguessable).
 */
import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

export { CREATE_ID_MAX_ATTEMPTS };

/** The minimal rate-limiter surface the Worker uses. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Try up to `maxAttempts` ids: generate one, call tryInitialize; if it
 * returns 'created' we are done, if 'exists' we try the next id. Returns
 * {ok:false} when every attempt was a collision.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let i = 0; i < maxAttempts; i++) {
    const id = generate();
    const result = await tryInitialize(id);
    if (result === 'created') {
      return { ok: true, id };
    }
  }
  return { ok: false };
}

/**
 * The minimal env surface createBoard needs (avoids importing the full
 * cloudflare:workers types in unit tests).
 */
interface CreateBoardEnv {
  BOARD_ROOM: {
    get(id: string): { initialize(): Promise<'created' | 'exists'> };
    idFromName(name: string): string;
  };
  BOARD_CREATE_LIMITER: Limiter;
}

/**
 * Create a new board: check the rate limiter, then retry over random ids
 * until one succeeds (initialize returns 'created'). Rate-limited visitors
 * get {ok:false, reason:'rate_limited'}; exhausted collisions or RPC
 * errors get {ok:false, reason:'create_failed'}.
 */
export async function createBoard(
  env: CreateBoardEnv,
  visitorKey: string,
  generate: () => string = newBoardId,
): Promise<CreateResult> {
  let success = false;
  try {
    const { success: lim } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
    success = lim;
  } catch {
    // If the limiter binding is unavailable, fail open (the board can still
    // be created; this is a local-dev convenience, not a production path).
    success = true;
  }
  if (!success) return { ok: false, reason: 'rate_limited' };

  try {
    const result = await createWithRetries(
      generate,
      async (id: string) => {
        const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
        return stub.initialize();
      },
    );
    return result.ok ? { ok: true, id: result.id } : { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
