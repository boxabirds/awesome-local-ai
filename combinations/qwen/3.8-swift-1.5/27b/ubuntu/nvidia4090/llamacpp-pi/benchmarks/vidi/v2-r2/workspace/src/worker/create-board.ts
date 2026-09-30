import { newBoardId } from '../shared/board-id';
import type { Env } from './board-room';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

/**
 * Story 5 (share.board_api): creates a new board.
 *
 * One 128-bit random id plus one `initialize()` RPC — no retry loop. A
 * collision between 128-bit random codes is not a realistic event, and if
 * `initialize()` ever reports `exists` for a freshly generated id, creation
 * fails with 500 rather than guessing again.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await stub.initialize();
    return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
  } catch {
    // The DO namespace is unreachable: creation failed, nothing was created.
    return { ok: false, reason: 'create_failed' };
  }
}
