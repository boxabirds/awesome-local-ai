/**
 * Making a board: one unguessable id, one call to the room that will hold it.
 *
 * Creation used to be an accident — anybody who reached an address that no board was using got
 * one, and there was no way to tell a first visit from a mistyped link. This is the deliberate
 * version: `POST /api/boards` comes here, and it is the only way a board comes into existence
 * (share.create).
 *
 * There is no retry loop, and that is a decision rather than an omission. The id is 16
 * cryptographic random bytes (128 bits), so a collision between two boards is not a practical
 * event; the one case where `initialize()` says `exists` for a freshly generated id is reported
 * as a failure, because the alternative — quietly handing out a board that is somebody else's —
 * is the thing that must never happen.
 */

import { newBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import type { Env } from './index';

/** What creating a board ended up being. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/** The room that will hold a board with this id. */
export function roomFor(env: Env, boardId: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

/**
 * Creates one empty board and returns its id.
 *
 * Two steps and nothing else: a new id from the cryptographic random source, and an RPC to the
 * Durable Object that owns that id, which makes its tables and marks itself as created. The id
 * is never derived from a counter, a clock or another board, which is what makes a link
 * unguessable rather than merely long (share.unguessable).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const result = await roomFor(env, id).initialize();
    if (result !== 'created') return { ok: false, reason: 'create_failed' };
    return { ok: true, id };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'board-create-failed',
        reason: 'create_failed',
        error: describe(error),
      }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}

/** Is there a board with this id? Never creates one. */
export async function boardExists(env: Env, boardId: string): Promise<boolean> {
  try {
    return await roomFor(env, boardId).exists();
  } catch (error) {
    // A board we cannot ask about is not a board we can hand out: the person on the other end
    // gets "Board not found" rather than an empty canvas that may be lying.
    console.error(
      JSON.stringify({
        event: 'board-exists-check-failed',
        error: describe(error),
      }),
    );
    return false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
