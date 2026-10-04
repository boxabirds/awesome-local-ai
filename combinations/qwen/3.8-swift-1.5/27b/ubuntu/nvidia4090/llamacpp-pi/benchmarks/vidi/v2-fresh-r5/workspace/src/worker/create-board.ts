/**
 * Server-side board creation (story 5, share.board_api): one 128-bit random
 * id plus one `initialize()` RPC on the board's Durable Object. There is no
 * retry loop — a collision between 128-bit random ids is not a practical
 * event, and if `initialize()` ever reports `exists` for a freshly generated
 * id, creation fails honestly with `create_failed` (500).
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await stub.initialize();
    if (result === 'created') return { ok: true, id };
    // A fresh 128-bit id already existed: fail rather than retry (not a
    // practical event — share.unguessable).
    return { ok: false, reason: 'create_failed' };
  } catch (err) {
    console.error('BOARD create failed', { error: String(err) });
    return { ok: false, reason: 'create_failed' };
  }
}
