import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import { newBoardId } from '../shared/board-id';

/**
 * Minimal interface matching the DurableObjectNamespace type from @cloudflare/workers-types.
 * Declared locally to avoid depending on the cloudflare:workers module in this file.
 */
interface DONamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): unknown;
}
interface DurableObjectId { toString(): string }

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    const result = await tryInitialize(id);
    if (result === 'created') {
      return { ok: true, id };
    }
  }
  return { ok: false };
}

export async function createBoard(
  env: { BOARD_ROOM: DONamespace; BOARD_CREATE_LIMITER: Limiter },
  visitorKey: string,
): Promise<CreateResult> {
  const limitResult = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
  if (!limitResult.success) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    const result = await createWithRetries(
      newBoardId,
      async (id: string): Promise<'created' | 'exists'> => {
        const doId = env.BOARD_ROOM.idFromName(id);
        const stub = env.BOARD_ROOM.get(doId) as { initialize(): Promise<'created' | 'exists'> };
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
