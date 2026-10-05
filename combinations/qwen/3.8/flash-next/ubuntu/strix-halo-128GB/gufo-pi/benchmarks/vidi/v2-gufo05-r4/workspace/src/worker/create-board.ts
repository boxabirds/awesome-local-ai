/**
 * Making a board exist (`share.create`, `share.unguessable`).
 *
 * One id, one RPC. There is no retry loop and there is deliberately no collision
 * handling beyond "say it failed": the id is 128 random bits, so the chance that the
 * next one names a board that already exists is not a practical event. Treating it as
 * one would mean either silently opening a stranger's board or pretending to have made
 * a new one, and a 500 is the honest answer to a question the maths says cannot be
 * asked twice.
 *
 * The id is generated here and nowhere else: story 3 generated it in the browser, which
 * meant a board was whatever address you happened to type. From now on the server hands
 * out addresses, and the ones it did not hand out belong to nobody (`share.not_found`).
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

/** The outcome of "make me a board". */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a board and return its address.
 *
 * "Created" means its Durable Object has the tables and a `created_at` row, so the very
 * next question — "does this board exist?" — is answered from storage rather than from
 * hope. A board that cannot be made is reported, never half-made.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await stub.initialize();
    if (outcome !== 'created') {
      // Only possible if two 128-bit ids came out the same. Say so loudly, and fail.
      console.error(JSON.stringify({ event: 'board_create_collision' }));
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (error) {
    console.error(JSON.stringify({ event: 'board_create_failed', error: textOf(error) }));
    return { ok: false, reason: 'create_failed' };
  }
}
