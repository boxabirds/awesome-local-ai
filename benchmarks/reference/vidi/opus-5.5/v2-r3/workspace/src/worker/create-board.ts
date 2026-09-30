// Board creation (share.create): one new 128-bit id and one initialize() RPC.
// No retry loop: two random 128-bit ids do not collide in practice, so a fresh id
// that already exists is treated as a failure (share.unguessable).
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    if (result === 'created') return { ok: true, id };
    console.error(JSON.stringify({ event: 'create-board.id-exists' }));
  } catch (e) {
    console.error(JSON.stringify({ event: 'create-board.failed', error: e instanceof Error ? e.message : String(e) }));
  }
  return { ok: false, reason: 'create_failed' };
}
