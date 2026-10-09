/**
 * Board creation (story 5, share.board_api).
 *
 * Creation is one 128-bit random id plus one Durable Object RPC: there is no
 * retry loop, because a collision between 128-bit random ids is not a
 * practical event (share.unguessable). If `initialize()` ever reports
 * `exists` for a freshly generated id, or the RPC throws, creation fails
 * with `create_failed` — the caller answers 500.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

type InitializeCall = () => Promise<'created' | 'exists'>;

/**
 * Test-only fault seam (TC-12): replaces the initialize() RPC that
 * createBoard makes. Set only by the /__test hook routes, which exist when
 * env.TEST_HOOKS === '1'; production code never sets it.
 */
let injectedInitialize: InitializeCall | null = null;

export function injectInitializeForTests(fn: InitializeCall | null): void {
  injectedInitialize = fn;
}

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  let result: 'created' | 'exists';
  try {
    if (injectedInitialize !== null) {
      result = await injectedInitialize();
    } else {
      // One BoardRoom object per board id; the RPC runs in the object's
      // actor context and writes the board's created_at.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
      result = await stub.initialize();
    }
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
  return result === 'created' ? { ok: true, id } : { ok: false, reason: 'create_failed' };
}
