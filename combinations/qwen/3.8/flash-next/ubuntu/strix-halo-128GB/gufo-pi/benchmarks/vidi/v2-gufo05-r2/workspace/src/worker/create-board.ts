/**
 * share.board_api: the one way a vidi6 board is started.
 *
 * A board begins as 16 cryptographic random bytes (`newBoardId`, story 3) and one
 * call: the Durable Object that will own the board migrates its storage and stamps
 * `created_at`, and only then does the address mean anything. That is the whole of
 * creation — there is no retry loop, because two 128-bit random ids colliding is
 * not a practical event; if `initialize()` ever reported an existing board for a
 * fresh id, creation fails with 500 rather than quietly taking a second address
 * (share.unguessable).
 *
 * Because creation happens here and nowhere else, `GET /api/boards/:id` can answer
 * "is this one of ours?" with a read, and an unknown address can be turned away
 * without leaving a trace (share.not_found).
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a board: a fresh id, one RPC into the object that will hold it.
 *
 * Never throws — the caller turns `create_failed` into a 500 and the home page into
 * "Couldn't create a board. Please try again." (share.create_failure).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const started = Date.now();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await room.initialize();
    if (outcome !== 'created') {
      // A 128-bit id that is already taken is not something to code around: the
      // honest answer is that creation failed, and nothing was opened at this link.
      console.error(
        JSON.stringify({ event: 'board_create_collision', board: id, ms: Date.now() - started }),
      );
      return { ok: false, reason: 'create_failed' };
    }
    console.log(JSON.stringify({ event: 'board_created', board: id, ms: Date.now() - started }));
    return { ok: true, id };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'board_create_failed',
        board: id,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}
