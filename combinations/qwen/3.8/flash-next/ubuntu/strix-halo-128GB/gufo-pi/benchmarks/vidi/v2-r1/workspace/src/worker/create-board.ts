/**
 * Board creation: generate a new id and initialize the Durable Object.
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: one id generation + one RPC.
 * No retry loop: a collision between 128-bit random ids is not a practical event.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const doId = env.BOARD_ROOM.idFromName(id);
    const stub = env.BOARD_ROOM.get(doId);
    const result = await (stub as unknown as { initialize(): Promise<'created' | 'exists'> }).initialize();
    if (result === 'exists') {
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
