import { CREATE_ID_MAX_ATTEMPTS } from '@shared/config';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Try to create a board with up to `maxAttempts` retries on collision.
 * Returns { ok: true, id } on success, { ok: false } if all attempts collide.
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
    // 'exists' means collision; try next id
  }
  return { ok: false };
}
