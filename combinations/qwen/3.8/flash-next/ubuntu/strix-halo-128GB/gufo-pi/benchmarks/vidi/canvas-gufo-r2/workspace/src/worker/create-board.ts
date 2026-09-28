/**
 * Board creation with collision retries and rate limiting.
 */
import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import type { Env } from './index';

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Retry board creation with a fresh id on collision.
 * Returns the first id where `tryInitialize` resolves 'created',
 * or `{ok:false}` after `maxAttempts` collisions.
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
      // 'exists' → collision, try next id
    } catch {
      // RPC threw → treat as collision for retry purposes
      // Actually the design says "exhausted or RPC throws → create_failed"
      // But looking more carefully: the design says "collisions exhausted or RPC throws → create_failed"
      // The createBoard function catches the throw and returns create_failed.
      // createWithRetries itself: if tryInitialize throws, we should let it propagate.
      // Actually re-reading the design: "all attempts collided or RPC threw → 500 create_failed"
      // The design shows createBoard handles the throw. createWithRetries only handles collision retries.
      // If tryInitialize throws, it propagates up to createBoard which catches it.
      throw new Error('initialize_threw');
    }
  }
  return { ok: false };
}

/**
 * Full creation flow: check rate limit, then retry generation.
 */
export async function createBoard(env: Env, visitorKey: string): Promise<CreateResult> {
  // Rate limit check
  const { success } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
  if (!success) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    const result = await createWithRetries(
      newBoardId,
      async (id: string) => {
        const doId = env.BOARD_ROOM.idFromName(id);
        const stub = env.BOARD_ROOM.get(doId);
        return (await stub.initialize()) as 'created' | 'exists';
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
