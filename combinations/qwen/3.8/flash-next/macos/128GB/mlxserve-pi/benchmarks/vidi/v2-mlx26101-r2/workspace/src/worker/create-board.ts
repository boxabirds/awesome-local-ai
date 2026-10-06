/**
 * Creating a board (design "Board creation and existence API").
 *
 * One id, one RPC, one small write. There is no retry loop: `newBoardId()` is 128
 * random bits, so a collision with a board that already exists is not a practical
 * event — and if it ever happened, `initialize()` would answer `exists` for an id
 * this request had just generated, which is not something this function can tell
 * apart from a board that was created by someone else a millisecond ago. The honest
 * answer to that is the one it already gives: say the board could not be created,
 * and let the person press the button again.
 *
 * The board is created *here*, on the server, and not by a client picking an
 * address: story 3 let the client mint ids, and story 5 cannot, because the thing
 * that makes a link safe to share is that nobody can guess one.
 */

import { newBoardId } from '../shared/board-id.js';
import type { BoardRoom } from './board-room.js';
import type { Env } from './index.js';

/** Did the board get made? The caller turns this into 201 or 500. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

const failed: CreateResult = { ok: false, reason: 'create_failed' };

/**
 * Make one new, empty board and return the id its link will carry.
 *
 * `initialize()` is the room's own RPC: it creates the tables and writes
 * `created_at`, which is what makes a board a board (design "Existence rule").
 * Anything thrown by the runtime — an RPC that failed, an object that would not
 * start — is `create_failed`: the person is told the truth and nothing is left
 * half-made, because the room writes its own `created_at` and nothing else, so a
 * failure leaves no board at the address that was asked for.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const room: DurableObjectStub<BoardRoom> = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));

  let outcome: 'created' | 'exists';
  try {
    outcome = await room.initialize();
  } catch (error) {
    console.error('[create-board] the board could not be initialised', { error: String(error) });
    return failed;
  }

  if (outcome !== 'created') {
    // A fresh 128-bit id that is already taken: see the file header.
    console.error('[create-board] a freshly generated id already exists', { id });
    return failed;
  }

  return { ok: true, id };
}
