import { newBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import type { Env } from './index';

/**
 * One board, created (`POST /api/boards`, story 5).
 *
 * A new board id is one call to `newBoardId()` — 128 bits of cryptographic randomness,
 * never derived from order, time, a creator or another board (`share.unguessable`) — and
 * creating the board is one RPC: `initialize()` on the board's own Durable Object, which
 * migrates and writes `created_at` in the same call. There is no retry loop, because a
 * collision between two 128-bit ids is not a practical event; if it ever happened, the
 * RPC would answer `exists` and this would report failure rather than adopt somebody
 * else's board.
 */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * The namespace this creates the board in. It is a parameter only so that an
 * integration test can hand it one whose `initialize()` throws — which is the one
 * service condition of this story that cannot be produced on demand (TC-12).
 */
export async function createBoard(
  env: Env,
  rooms: DurableObjectNamespace<BoardRoom> = env.BOARD_ROOM,
): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const outcome = await rooms
      .get(rooms.idFromName(id))
      .initialize();
    if (outcome !== 'created') {
      // `exists` for a freshly generated id means a collision: fail, do not take over.
      console.error(JSON.stringify({ event: 'board_create_collision', id }));
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'board_create_failed', error: error instanceof Error ? error.message : String(error) }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}
