// share.board_api: boards are created on the server with an unguessable id.
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * One fresh 128-bit id, initialised by one RPC. No retry loop: a collision between
 * random 128-bit ids is not a practical event, and if `initialize()` ever reports
 * `exists` for a fresh id, creation fails rather than joining someone else's board.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const result = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
    if (result === 'created') return { ok: true, id };
    console.error(JSON.stringify({ event: 'board-create-collision' }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'board-create-failed', error: String(error) }));
  }
  return { ok: false, reason: 'create_failed' };
}
