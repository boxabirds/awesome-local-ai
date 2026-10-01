// src/worker/create-board.ts
// Server-side board creation: generates a 128-bit random id and initialises the board's Durable Object.

import { newBoardId } from '../shared/board-id';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: {
  BOARD_ROOM: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): { initialize(): Promise<'created' | 'exists'> };
  };
}): Promise<CreateResult> {
  const id = newBoardId();
  const stubId = env.BOARD_ROOM.idFromName(id);
  const stub = env.BOARD_ROOM.get(stubId);
  try {
    const result = await stub.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // 'exists' means a collision (practically impossible with 128-bit ids)
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
