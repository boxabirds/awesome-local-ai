import type { Env } from './index';
import { newBoardId } from '../shared/board-id';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const doId = env.BOARD_ROOM.idFromName(id);
  const stub = env.BOARD_ROOM.get(doId);
  try {
    const res = await stub.fetch(new Request('http://internal/initialize', { method: 'POST' }));
    if (res.status === 200) {
      return { ok: true, id };
    }
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
