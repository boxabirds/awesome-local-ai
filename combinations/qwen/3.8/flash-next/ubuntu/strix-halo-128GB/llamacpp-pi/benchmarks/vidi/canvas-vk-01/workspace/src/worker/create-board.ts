import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import { newBoardId } from '../shared/board-id';

/** Rate limiter interface (matches the Workers `RateLimit` binding). */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Result of a board creation attempt. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Try up to `maxAttempts` generated ids, returning the first one that
 * `tryInitialize` reports as 'created'. Returns `{ ok: false }` if all
 * attempts collide or throw.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    try {
      const result = await tryInitialize(id);
      if (result === 'created') {
        return { ok: true, id };
      }
      // 'exists' — collision, try next id
    } catch {
      // RPC threw, counts as a failed attempt
    }
  }
  return { ok: false };
}

/**
 * Create a new board: check rate limit, generate id, try to initialize.
 * Takes a resolved `initializeBoard` function so the file does not import
 * Cloudflare Durable Object types, keeping `createWithRetries` testable in
 * a plain Node environment.
 */
export async function createBoard(
  limiter: Limiter,
  initializeBoard: (id: string) => Promise<'created' | 'exists'>,
  visitorKey: string,
): Promise<CreateResult> {
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) {
    return { ok: false, reason: 'rate_limited' };
  }

  const result = await createWithRetries(newBoardId, initializeBoard);
  if (result.ok) return result;
  return { ok: false, reason: 'create_failed' };
}
