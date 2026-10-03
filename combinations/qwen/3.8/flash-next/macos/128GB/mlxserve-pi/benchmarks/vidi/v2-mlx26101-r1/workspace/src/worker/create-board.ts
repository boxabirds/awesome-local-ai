// share.board_api: the one way a board comes into existence.
//
// A new board is one fresh 128-bit id from `newBoardId()` plus one `initialize()`
// RPC, which creates the room's SQLite tables and stamps `created_at`. There is no
// retry loop: with 128 random bits an id collision is not a practical event, so if
// `initialize()` ever answers anything but `created` — the address taken, or the
// write impossible — creation fails with `create_failed` (→ HTTP 500) instead of
// quietly adopting somebody else's board.
//
// Because the code is drawn from `crypto.getRandomValues` and never from a counter,
// a timestamp or another board's link, a link cannot be guessed or derived
// (share.unguessable).

import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { Env } from './index';

/** The outcome of a create attempt. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

/**
 * Create a new empty board and return its id. Never throws: an RPC that fails or
 * reports anything but `created` (the object could not be reached, the write could
 * not happen, the address is taken) is reported as `create_failed` so the caller can
 * answer 500 and the home page can say so.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const result = await room.initialize();
    if (result !== 'created') {
      console.error(
        JSON.stringify({ event: 'board-create-refused', reason: result }),
      );
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'board-create-failed', error: String(error) }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}

/**
 * Does this board exist? Malformed ids are answered `false` without touching the
 * namespace, so a garbage link never instantiates an object (TC-07) — and, like an
 * unknown id, gives the caller nothing to distinguish the two (no leaking).
 */
export async function boardExists(env: Env, id: string): Promise<boolean> {
  if (!isValidBoardId(id)) return false;
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return room.exists();
}
