import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: generate one id, call initialize() on the BoardRoom DO.
 * No retry loop: 128-bit random ids do not collide in practice.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const docId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(docId);
    const result = await stub.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // 'exists' for a freshly generated id is practically impossible, but handle it
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
