// Creating a board: the only path in the service that brings one into existence.
//
// `POST /api/boards` is a click on "New board", and it is what makes a link worth
// sending: the id in a link is a *name the service knows* because this function
// named a Durable Object and stamped it with `created_at`. Nothing else creates -
// a socket upgrade for an unknown id is refused (see `BoardRoom.fetch`), so a
// mistyped link cannot manufacture a board that looks like a lost one.
//
// The id is 128 bits of randomness from `newBoardId()`; a caller never proposes an
// id, so there is no "is this id free" race to lose, and there is no retry loop:
// two 128-bit ids colliding is not a practical event, and if it ever happened the
// honest answer is "creation failed" rather than silently handing the caller
// somebody else's board.

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

/** What `POST /api/boards` answers. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Name a fresh board and hand it to its own Durable Object.
 *
 * Never throws: if the object cannot be reached, or cannot write its schema, or
 * answers that the id it was given already belongs to a board, the caller gets
 * `create_failed` and answers 500 - so the page says "Couldn't create a board.
 * Please try again." instead of opening a board that is not there (TC-12).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  let outcome: 'created' | 'exists';
  try {
    outcome = await stub.initialize();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'board_create_failed',
        reason: 'rpc_threw',
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
    );
    return { ok: false, reason: 'create_failed' };
  }
  if (outcome !== 'created') {
    // A 128-bit id that another board already answers to. Reported, not papered
    // over: the board this caller is being sent would not be the one they made.
    console.error(JSON.stringify({ event: 'board_create_failed', reason: 'id_collision' }));
    return { ok: false, reason: 'create_failed' };
  }
  return { ok: true, id };
}
