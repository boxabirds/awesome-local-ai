/** Board creation — story 5: generate id + initialise via RPC */

import { newBoardId } from '@shared/board-id';
import type { Env } from './index';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: one `newBoardId()` + one `initialize()` RPC call.
 * Collision of 128-bit ids is not a practical event, so no retry loop.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const roomId = env.BOARD_ROOM.idFromName(id);
  const room = env.BOARD_ROOM.get(roomId);

  try {
    // Cast to any since DurableObjectStub types don't include our custom methods
    const result = await (room as any).initialize();
    if (result === 'exists') {
      // Fresh id somehow already initialised — fail gracefully (extremely rare)
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
