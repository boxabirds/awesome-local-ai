import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateBoardResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

// share.board_api: draw a fresh 128-bit code, then ask that board's Durable
// Object to initialize itself (the only path that writes a new board). If the
// object cannot confirm, report a retryable error; the failed code is simply
// absent (initialize is all-or-nothing) and the caller may try again.
export async function createBoard(env: Env): Promise<CreateBoardResult> {
  const id = newBoardId();
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    await stub.initialize();
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
