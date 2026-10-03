/**
 * Server-side board creation (story 5, share.board_api).
 *
 * One `newBoardId()` (16 random bytes, 128 bits) plus one `initialize()`
 * RPC. No retry loop: a collision between 128-bit random ids is not a
 * practical event; if `initialize()` ever reports 'exists' for a fresh id,
 * creation fails with `create_failed` (HTTP 500) rather than guessing again.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export interface CreateBoardOptions {
  /** Test hook (TC-12): make the initialize() RPC throw. */
  failInitialize?: boolean;
}

export async function createBoard(
  env: Env,
  opts: CreateBoardOptions = {},
): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    if (opts.failInitialize) {
      throw new Error('injected initialize failure (test hook)');
    }
    const result = await stub.initialize();
    if (result === 'exists') {
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
