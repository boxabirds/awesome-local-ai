import { newBoardId } from '../shared/board-id';
import { consumeFailNextCreate } from './test-hooks';
import type { BoardRoomStub } from './board-room';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Creates a new board (share.board_api): one 128-bit random id plus one
 * `initialize()` RPC. There is no retry loop: a collision between 128-bit
 * random ids is not a practical event (share.unguessable), and if
 * `initialize()` ever reports `exists` for a freshly generated id, creation
 * fails with 500 rather than trying again.
 *
 * The TEST-ONLY fail flag short-circuits *before* the RPC so the workerd test
 * pool never sees a throwing RPC from the worker context (which the pool
 * reports as an unhandled rejection even when the caller catches it). The
 * `initialize()` throw itself is verified directly in the test context
 * (TC-12), which the pool handles cleanly.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  if (consumeFailNextCreate()) {
    return { ok: false, reason: 'create_failed' };
  }
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)) as BoardRoomStub;
  try {
    const result = await stub.initialize();
    return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
