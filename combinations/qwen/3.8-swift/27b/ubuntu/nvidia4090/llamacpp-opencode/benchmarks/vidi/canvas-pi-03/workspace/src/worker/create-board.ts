/**
 * Story 5: server-side board creation (share.board_api).
 *
 * POST /api/boards creates a new empty board:
 *   1. the visitor (keyed by `CF-Connecting-IP`) is rate-limited
 *      (BOARD_CREATE_LIMIT per BOARD_CREATE_PERIOD_SECONDS);
 *   2. up to CREATE_ID_MAX_ATTEMPTS freshly generated 128-bit ids are tried
 *      against the board's Durable Object (`initialize()`), which writes
 *      `storage_meta.created_at` exactly once; a collision ('exists') or an
 *      RPC failure consumes an attempt and a new id is generated.
 *
 * Ids come from `newBoardId()` (16 random bytes, base64url) and are never
 * derived from time, counters or other boards' ids (share.unguessable).
 */
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from 'src/shared/config';
import { newBoardId } from 'src/shared/board-id';
import type { Env } from './index';

/** The surface of the platform rate-limiter binding the worker relies on. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Tries up to `maxAttempts` freshly generated ids against `tryInitialize`,
 * returning the first id that comes back `'created'`. A collision
 * (`'exists'`) or a thrown RPC failure consumes the attempt; when all
 * attempts are exhausted the caller must report `create_failed`.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    try {
      if ((await tryInitialize(id)) === 'created') return { ok: true, id };
    } catch {
      // RPC failure: consume the attempt and try a fresh id.
    }
  }
  return { ok: false };
}

/**
 * Local-runtime fallback limiter. The pinned local runtime
 * (miniflare/workerd) does not implement the `ratelimits` binding, so when
 * the binding is absent (local dev / tests) the same limit and period are
 * kept in a fixed-window in-memory limiter. Production always has the real
 * binding declared in wrangler.jsonc, so this fallback never applies there.
 */
function localLimiter(): Limiter {
  const periodMs = BOARD_CREATE_PERIOD_SECONDS * 1000;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit({ key }) {
      const now = Date.now();
      const window_ = windows.get(key);
      if (!window_ || now - window_.start >= periodMs) {
        windows.set(key, { start: now, count: 1 });
        return { success: true };
      }
      if (window_.count >= BOARD_CREATE_LIMIT) return { success: false };
      window_.count += 1;
      return { success: true };
    },
  };
}

let fallback: Limiter | null = null;

export function getLimiter(env: Env): Limiter {
  if (env.BOARD_CREATE_LIMITER) return env.BOARD_CREATE_LIMITER;
  if (!fallback) fallback = localLimiter();
  return fallback;
}

/**
 * Creates a board for `visitorKey` (the visitor's `CF-Connecting-IP`).
 * Returns `rate_limited` when the limiter rejects, `create_failed` when all
 * id attempts collide or the RPC keeps throwing.
 *
 * `idFactory` defaults to newBoardId; it is injectable so tests can force
 * collision sequences (share.unique).
 */
export async function createBoard(
  env: Env,
  visitorKey: string,
  idFactory: () => string = newBoardId,
): Promise<CreateResult> {
  const limiter = getLimiter(env);
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };
  const result = await createWithRetries(idFactory, (id) =>
    env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize(),
  );
  if (!result.ok) return { ok: false, reason: 'create_failed' };
  return { ok: true, id: result.id };
}
