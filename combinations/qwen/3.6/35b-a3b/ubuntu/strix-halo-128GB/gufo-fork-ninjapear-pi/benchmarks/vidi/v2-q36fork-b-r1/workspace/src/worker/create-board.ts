/**
 * Board creation endpoint.
 * Story 5 — share a board with others using a link.
 *
 * Generates one newBoardId() and calls initialize() RPC once.
 * No retry loop — 128-bit random IDs do not collide in practice.
 */
import { newBoardId } from '@/shared/board-id';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

interface RoomBinding {
  get(id: string): BoardRoomDO;
  idFromName(name: string): string;
}

export interface Env {
  BOARD_ROOM: RoomBinding;
}

/** BoardRoom Durable Object with initialize/exists RPC methods */
export interface BoardRoomDO {
  initialize(): Promise<'created' | 'exists'>;
}

/**
 * Create a new board: generate an id, initialize it via RPC.
 * Returns {ok:true,id} on success or {ok:false,reason:'create_failed'} on failure.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const result = await room.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // Already initialized for this id (collision) → fail with 500
    return { ok: false, reason: 'create_failed' };
  } catch {
    console.error(JSON.stringify({ event: 'create-failed', id }));
    return { ok: false, reason: 'create_failed' };
  }
}
