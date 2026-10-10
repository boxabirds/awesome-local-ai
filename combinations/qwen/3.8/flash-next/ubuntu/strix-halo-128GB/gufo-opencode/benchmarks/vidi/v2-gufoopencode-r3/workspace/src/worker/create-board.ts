import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

// Injectable so tests can force RPC failure (TC-12); production uses the real
// namespace + generator. A fresh id whose initialize() reports 'exists' would
// be a 128-bit collision — not a practical event — so creation simply fails
// with create_failed rather than retrying (design.share.board_api).
export interface CreateBoardDeps {
  newId?: () => string;
  initialize?: (id: string) => Promise<'created' | 'exists'>;
}

export async function createBoard(env: Env, deps: CreateBoardDeps = {}): Promise<CreateResult> {
  const id = (deps.newId ?? newBoardId)();
  const init =
    deps.initialize ??
    ((boardId: string) => {
      const namespace = env.BOARD_ROOM;
      return namespace.get(namespace.idFromName(boardId)).initialize();
    });
  try {
    const outcome = await init(id);
    if (outcome !== 'created') return { ok: false, reason: 'create_failed' };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
