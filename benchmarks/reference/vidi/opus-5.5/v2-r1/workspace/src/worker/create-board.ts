import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Creates a new empty board under a fresh random id (share.unguessable) and initialises its
 * room. No retry: two 128-bit random ids do not collide in practice, so an id that already
 * exists means something is wrong and creation fails.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await room.initialize();
    if (outcome !== 'created') {
      console.error(JSON.stringify({ event: 'create-board.id-exists' }));
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (e) {
    console.error(JSON.stringify({ event: 'create-board.failed', error: String(e) }));
    return { ok: false, reason: 'create_failed' };
  }
}
