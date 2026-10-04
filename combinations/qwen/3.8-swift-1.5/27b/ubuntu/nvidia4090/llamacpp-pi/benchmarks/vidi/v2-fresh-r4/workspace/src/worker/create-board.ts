/**
 * Board creation: generates a new 128-bit random id and initialises the
 * board's Durable Object via one RPC call. No retry loop: a collision
 * between 128-bit random ids is not a practical event.
 */
import { newBoardId } from '../shared/board-id';

type Env = {
  BOARD_ROOM: DurableObjectNamespace;
};

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const result = await (stub as unknown as { initialize(): Promise<'created' | 'exists'> }).initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // 'exists' for a fresh id = collision (not practical, but handle gracefully)
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
