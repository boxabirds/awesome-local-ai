/**
 * Making a board.
 *
 * One call, one board, one place. It is here rather than in the Worker's routing table because
 * it is the only thing in this product that brings a board into existence, and because the two
 * decisions it makes are worth reading together:
 *
 * **The id is drawn here, from the platform's cryptographic random source** (see
 * `src/shared/board-id.ts`). A board has no accounts, no passwords and no permission list: the
 * link is the whole of its access control, so the strength of a board is the strength of this one
 * line. It is 16 bytes, which is 22 characters of base64url, which is why two people drawing the
 * same link is not an event worth writing a retry loop for.
 *
 * **The board is created by its own room, not by a row in a table of boards.** There is no such
 * table, and there never was going to be one in a product with no accounts: the room object that
 * the address already names is asked to say it exists. That is one RPC, it writes one row in that
 * board's own storage, and nothing about a new board is shared with any other board — so a board
 * cannot be created *over* another one, and making ten thousand boards costs ten thousand objects
 * that do not know about each other.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './board-room';

/** What asking for a board turned out to be. */
export type CreatedBoard =
  /** A board, and the address it lives at. */
  | { ok: true; id: string }
  /** No board. The person is told to try again, and nothing is half-made. */
  | { ok: false; reason: 'create_failed' };

/**
 * Create a board and hand back its id.
 *
 * The request that arrives here has no body and no identity: there is nothing to create a board
 * *from*. What comes back is either an id or a refusal, and the refusal is deliberately not
 * explained to the person beyond "try again" — the reasons it can fail (this object could not be
 * reached, its storage would not take the row) are all reasons a retry may fix, and none of them
 * is something a person can act on.
 *
 * `'exists'` from a board that was just drawn is the id collision: impossible at 128 bits, and
 * treated as a failure all the same, because the one thing this function must never do is hand
 * somebody a link to a board that already has somebody else's notes on it.
 */
export async function createBoard(env: Env): Promise<CreatedBoard> {
  const id = newBoardId();
  // The name *is* the id: `idFromName` picks the object this address means, so the room being
  // asked is the room that will answer every later connection to this link.
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const outcome = await room.initialize();
    if (outcome === 'exists') {
      console.error(`board ${id} already exists; refusing to hand out its link`);
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (error) {
    // Nothing was created that anybody can reach: at worst this leaves a room object with no
    // board in it, which is what every mistyped link leaves behind too, and which is why the
    // existence check reads storage rather than trusting that an object exists.
    console.error(
      `create-board: could not create ${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, reason: 'create_failed' };
  }
}
