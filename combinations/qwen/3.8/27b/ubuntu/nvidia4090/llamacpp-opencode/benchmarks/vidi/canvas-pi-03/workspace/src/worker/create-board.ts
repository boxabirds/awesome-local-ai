import { newBoardId } from '@/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '@/shared/config';

/**
 * Server-side board creation (story 5, share.board_api).
 *
 * `POST /api/boards` → rate-limit the visitor → generate a fresh 128-bit id →
 * RPC `initialize()` on the board's Durable Object. `initialize` is idempotent
 * and returns 'exists' when the id is already taken, so a collision simply
 * draws a new id (share.unique: a taken code is never handed out).
 */

/**
 * The rate-limit interface. In production the platform `ratelimits` binding
 * (wrangler.jsonc: BOARD_CREATE_LIMITER) implements it; the pinned local
 * workerd runtime (wrangler 3.x dev) does not expose the binding, so local
 * dev and the test suite run against an in-memory fixed-window
 * implementation of the same interface (see NOTES.md).
 */
export interface Limiter {
  limit(opts: { key: string; limit?: number; periodSeconds?: number }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/** Test-only injection points (honoured only on TEST_HOOKS dev servers). */
export interface CreateOpts {
  /** Ids handed out before the generator falls back to newBoardId() (collision injection). */
  testIds?: string[];
  /** Makes every initialize attempt throw (create_failed injection). */
  failInitialize?: boolean;
}

/**
 * Generates ids and tries to initialize them until one is free.
 * `tryInitialize` must return 'exists' for a taken id and 'created' for a free
 * one; anything it throws propagates to the caller.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    const outcome = await tryInitialize(id);
    if (outcome === 'created') return { ok: true, id };
  }
  return { ok: false };
}

/**
 * Fixed-window in-memory limiter (one per worker instance). Functionally
 * equivalent to the platform binding for local development and tests: the
 * same fixed window, the same limit, the same per-key accounting.
 */
function createMemoryLimiter(limit: number, periodSeconds: number): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    limit({ key }): Promise<{ success: boolean }> {
      const windowMs = periodSeconds * 1000;
      const now = Date.now();
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return Promise.resolve({ success: true });
      }
      if (w.count >= limit) return Promise.resolve({ success: false });
      w.count += 1;
      return Promise.resolve({ success: true });
    },
  };
}

const memoryLimiter: Limiter = createMemoryLimiter(BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function limiterFor(env: any): Limiter {
  // In production env.BOARD_CREATE_LIMITER is the platform binding; the local
  // runtime leaves it undefined, so the in-memory limiter takes over.
  return env.BOARD_CREATE_LIMITER ?? memoryLimiter;
}

/**
 * Creates a board for `visitorKey` (the visitor's rate-limit key; in
 * production the request's CF-Connecting-IP, or the x-test-visitor header on
 * TEST_HOOKS servers). Returns the new board id, or a reason so the worker
 * can answer 429 / 500 per the HTTP contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createBoard(env: any, visitorKey: string, opts: CreateOpts = {}): Promise<CreateResult> {
  const { success } = await limiterFor(env).limit({
    key: visitorKey,
    limit: BOARD_CREATE_LIMIT,
    periodSeconds: BOARD_CREATE_PERIOD_SECONDS,
  });
  if (!success) return { ok: false, reason: 'rate_limited' };

  const queue = [...(opts.testIds ?? [])];
  const generate = (): string => (queue.length > 0 ? queue.shift() as string : newBoardId());

  try {
    const result = await createWithRetries(generate, async (id) => {
      if (opts.failInitialize) throw new Error('injected initialize failure (test hook)');
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
      return await stub.initialize();
    });
    return result.ok
      ? { ok: true, id: result.id }
      : { ok: false, reason: 'create_failed' };
  } catch {
    // The DO RPC itself failed (storage unavailable, injected fault, …).
    return { ok: false, reason: 'create_failed' };
  }
}
