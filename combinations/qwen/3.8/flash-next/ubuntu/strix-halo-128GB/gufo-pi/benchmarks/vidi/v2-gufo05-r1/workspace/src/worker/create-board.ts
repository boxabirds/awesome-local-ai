/**
 * Creating a board.
 *
 * One id, one RPC. The id comes from `newBoardId()` — 128 random bits, which is the
 * whole access control of the product (prd: possession of the link is the only
 * permission) — and the RPC is `BoardRoom.initialize()`, which makes the address a
 * board by creating its tables and writing `created_at`.
 *
 * There is no retry loop, on purpose. A collision between two 128-bit draws is not a
 * practical event; if `initialize()` ever answers `exists` for an id that was just
 * generated, the honest response is a failure for the person to retry, not a silent
 * hand-over of somebody else's board.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Give a board an address and make it exist. Never returns a half-made board. */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  let outcome: 'created' | 'exists';
  try {
    outcome = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize();
  } catch (error) {
    // Whatever the object said — no instance, no storage, a call that never came back —
    // the person is told the same thing, and nothing is half-created.
    console.error(
      JSON.stringify({ event: 'board-create-failed', stage: 'initialize', error: describe(error) }),
    );
    return { ok: false, reason: 'create_failed' };
  }
  if (outcome !== 'created') {
    console.error(JSON.stringify({ event: 'board-create-collided' }));
    return { ok: false, reason: 'create_failed' };
  }
  return { ok: true, id };
}
