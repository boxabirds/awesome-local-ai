import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/** One id, one RPC; a collision between 128-bit ids is not a practical event, so there is no retry loop. */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
