import { newBoardId } from '@shared/board-id';
import type { Env } from './index';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

/**
 * Create a brand-new board: generate one 128-bit random id and initialise its
 * Durable Object with a single `initialize()` RPC (share.create). There is no
 * retry loop — a collision between 128-bit random ids is not a practical event
 * (share.unguessable), so if `initialize()` ever reports the id already exists,
 * or the RPC throws, creation fails with `create_failed` (-> HTTP 500).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const result = await stub.initialize();
    if (result === 'created') return { ok: true, id };
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
