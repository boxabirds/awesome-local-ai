import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

/**
 * Making a board, which from story 5 is a thing the service does and not a thing an address
 * does by itself.
 *
 * One id, one call to the board's own object: `initialize()` creates the storage tables and
 * writes the creation date that says this link belongs to a board (share.not_found gives every
 * other link the Board not found page). There is no retry loop, because the id is 128 random
 * bits - a collision with a board that already exists is not a practical event, and the one
 * that was unlucky enough to happen is reported as a failure rather than quietly answered with
 * somebody else's board (share.unguessable, "Not covered").
 */

/** What asking for a board ended up being. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new, empty board and hand back the id its link will be made from.
 *
 * Nothing about the id is chosen here beyond "random": it is not derived from the time, from a
 * counter, from who is asking or from any other board, so knowing one link tells you nothing
 * about how to make or find another.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    // `initialize()` is Durable Object RPC: a method call on the object, which runs on the
    // object's own input gate, so two creations can never interleave with a board's work.
    if ((await room.initialize()) === 'created') {
      return { ok: true, id };
    }
    // The id was unlucky and landed on a board that already exists. Nobody is served a board
    // that is not the one they made, so this is a failure and the person is asked to try again.
    console.error(`board ${id}: a freshly generated id was already in use`);
    return { ok: false, reason: 'create_failed' };
  } catch (error) {
    console.error(`board ${id}: could not be created (${String(error)})`);
    return { ok: false, reason: 'create_failed' };
  }
}
