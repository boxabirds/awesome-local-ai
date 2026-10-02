import { newBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Injectable initialize implementation (test hook, TC-12): allows tests to
 * make the RPC throw without touching a real Durable Object.
 */
export type InitializeFn = (
  stub: DurableObjectStub<BoardRoom>,
) => Promise<'created' | 'exists'>;

/**
 * Create a board: one 128-bit random id (share.unguessable) plus one
 * `initialize()` RPC (share.board_api). No retry loop: a collision between
 * 128-bit random ids is not a practical event; if `initialize()` ever
 * returns 'exists' for a fresh id, creation fails with 500.
 */
export async function createBoard(
  env: Env,
  initialize?: InitializeFn,
): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  let outcome: 'created' | 'exists';
  try {
    outcome = initialize ? await initialize(stub) : await stub.initialize();
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
  if (outcome !== 'created') {
    return { ok: false, reason: 'create_failed' };
  }
  return { ok: true, id };
}

/** POST /api/boards handler (share.board_api HTTP contract). */
export async function handleCreateBoardRequest(
  env: Env,
  initialize?: InitializeFn,
): Promise<Response> {
  const result = await createBoard(env, initialize);
  if (result.ok) {
    return new Response(JSON.stringify({ id: result.id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'create_failed' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
