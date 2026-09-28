// Server-side board creation: a fresh 128-bit id, initialised in its own BoardRoom, behind a per-visitor rate
// limit. A generated id that already belongs to a board is never handed out; another one is tried instead.
//
// The env is typed structurally (the real `Env` satisfies it) so the pure retry logic can be unit tested
// outside the Workers runtime.
import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'rate_limited' | 'create_failed' };

export interface CreateBoardEnv {
  BOARD_CREATE_LIMITER: Limiter;
  BOARD_ROOM: {
    idFromName(name: string): any;
    get(id: any): { initialize(): Promise<'created' | 'exists'> };
  };
}

export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    if ((await tryInitialize(id)) === 'created') return { ok: true, id };
  }
  return { ok: false };
}

/**
 * Creates a board for `visitorKey` (the visitor's IP). `generate` is replaceable only so tests can force
 * id collisions; production always uses `newBoardId()`.
 */
export async function createBoard(
  env: CreateBoardEnv,
  visitorKey: string,
  generate: () => string = newBoardId,
): Promise<CreateResult> {
  const { success } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };
  try {
    const result = await createWithRetries(generate, (id) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());
    if (result.ok) return result;
    console.error(JSON.stringify({ event: 'board_create_collisions_exhausted' }));
  } catch (e) {
    console.error(JSON.stringify({ event: 'board_create_failed', error: e instanceof Error ? e.message : String(e) }));
  }
  return { ok: false, reason: 'create_failed' };
}
