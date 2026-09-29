import type { Env } from './env';
import { newBoardId } from '@shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS } from '@shared/config';
export { createWithRetries } from '@shared/create-board-pure';
export type { CreateResult } from '@shared/create-board-pure';
import type { CreateResult } from '@shared/create-board-pure';

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/**
 * In-memory rate limiter fallback for environments where the platform
 * RateLimit binding is unavailable (e.g. vitest-pool-workers local runtime).
 * Implements the same `Limiter` interface.
 */
class MemoryRateLimiter implements Limiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async limit(opts: { key: string }): Promise<{ success: boolean }> {
    const now = Date.now();
    const bucket = this.buckets.get(opts.key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(opts.key, { count: 1, resetAt: now + BOARD_CREATE_PERIOD_SECONDS * 1000 });
      return { success: true };
    }
    bucket.count++;
    return { success: bucket.count <= BOARD_CREATE_LIMIT };
  }
}

// Singleton for the worker isolate (survives across requests in the same runtime)
let fallbackLimiter: Limiter | null = null;

/** Reset the in-memory rate limiter (test-only). */
export function resetFallbackLimiter(): void {
  fallbackLimiter = null;
}

function getLimiter(env: Env): Limiter {
  if (env.BOARD_CREATE_LIMITER) {
    return env.BOARD_CREATE_LIMITER;
  }
  if (!fallbackLimiter) {
    fallbackLimiter = new MemoryRateLimiter();
  }
  return fallbackLimiter;
}

/**
 * Full board creation: rate-limit check + collision retry loop.
 */
export async function createBoard(env: Env, visitorKey: string): Promise<CreateResult> {
  // Import here to avoid circular dependency in type resolution
  const { createWithRetries } = await import('@shared/create-board-pure');

  // Rate limit check
  const limiter = getLimiter(env);
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) {
    return { ok: false, reason: 'rate_limited' };
  }

  // Collision retry loop
  try {
    const result = await createWithRetries(
      () => newBoardId(),
      async (id: string) => {
        const doId = env.BOARD_ROOM.idFromName(id);
        const stub = env.BOARD_ROOM.get(doId);
        return stub.initialize();
      },
    );
    if (result.ok) {
      return { ok: true, id: result.id };
    }
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
