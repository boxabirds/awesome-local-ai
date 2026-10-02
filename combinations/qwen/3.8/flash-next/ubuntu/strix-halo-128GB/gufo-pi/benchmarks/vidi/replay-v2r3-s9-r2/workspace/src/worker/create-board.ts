import { newBoardId } from '../shared/board-id';
import type { Env } from './index';
import type { BoardRoom } from './board-room';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Creates a new board: generates an id, calls `initialize()` on the Durable Object.
 * No retry loop — a collision between 128-bit random ids is not a practical event.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId);
    const result = await (stub as unknown as BoardRoom).initialize();
    if (result === 'exists') {
      // Collision on a freshly generated id (practically impossible with 128 bits)
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
