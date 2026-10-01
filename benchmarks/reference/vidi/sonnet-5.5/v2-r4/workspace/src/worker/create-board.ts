import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/** One fresh 128-bit id and one initialize() RPC; a collision (practically impossible) fails rather than retries. */
export async function createBoard(env: Env): Promise<CreateResult> {
  try {
    const id = newBoardId();
    const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
  } catch (e) {
    console.error(JSON.stringify({ event: 'create-failed', error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, reason: 'create_failed' };
  }
}
