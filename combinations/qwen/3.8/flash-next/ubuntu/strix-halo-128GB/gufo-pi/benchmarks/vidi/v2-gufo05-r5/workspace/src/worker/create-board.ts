/**
 * Board creation (story 5).
 *
 * `createBoard` generates one 128-bit random id and calls `initialize()` on the board's
 * Durable Object via RPC. There is no retry loop: with 128 bits of randomness a collision
 * is not a practical event. If `initialize()` ever returns `exists` for a fresh id, or
 * the RPC throws, creation fails with `create_failed`.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Creates a new board: generates an id, initializes the Durable Object.
 * One id generation plus one RPC; no retry.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const result = await stub.initialize();
    if (result === 'exists') {
      // A collision on 128 random bits is not a practical event; if it happens, fail.
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
