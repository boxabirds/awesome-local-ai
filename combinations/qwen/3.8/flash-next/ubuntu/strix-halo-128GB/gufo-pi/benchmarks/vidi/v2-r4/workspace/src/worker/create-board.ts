import { newBoardId } from '../shared/board-id';
import type { Env } from './index';
import type { BoardRoom } from './board-room';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: generate one 128-bit random id, call initialize() via RPC.
 * No retry loop: a collision between 128-bit random ids is not a practical event.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  // Test hook: inject a throw to simulate RPC failure
  if ((env as any).__testFailNextInitialize === '1') {
    (env as any).__testFailNextInitialize = undefined;
    return { ok: false, reason: 'create_failed' };
  }
  const id = newBoardId();
  try {
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId) as DurableObjectStub<BoardRoom>;
    const result = await stub.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // 'exists' for a freshly generated id is a collision (extremely unlikely)
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
