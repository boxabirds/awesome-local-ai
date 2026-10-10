// share.board_api: create a board server-side. One 128-bit random id plus
// one `initialize()` RPC on the board's Durable Object. There is no retry
// loop: a collision between 128-bit random ids is not a practical event, so
// if initialize() ever answers `exists` for a freshly generated id (or the
// RPC throws), creation fails with create_failed and the worker replies 500.

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  try {
    const id = newBoardId();
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await stub.initialize();
    if (outcome !== 'created') return { ok: false, reason: 'create_failed' };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
