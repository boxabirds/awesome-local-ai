import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/** One fresh 128-bit id and one RPC. No retry: a collision is not a practical event and fails the request. */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
  } catch (e) {
    console.error(JSON.stringify({ event: 'create-board-failed', error: String(e) }));
    return { ok: false, reason: 'create_failed' };
  }
}
