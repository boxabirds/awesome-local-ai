// Board creation (spec: share.board_api).
//
// POST /api/boards flow: rate-limit the visitor (CF-Connecting-IP key), then
// loop up to CREATE_ID_MAX_ATTEMPTS times: generate a fresh 128-bit id and
// ask the board's BoardRoom to initialize. `initialize` returns 'exists' only
// on the (astronomically rare) collision with an already-created board, so a
// taken code is never handed out (share.unique). Exhausted attempts or an RPC
// failure → create_failed (500).
//
// The env parameter is declared structurally (not as the worker's `Env`) so
// this module typechecks under the node-pool unit tests, where the
// `cloudflare:workers` types are unavailable — the same pattern board-store.ts
// uses for DurableObjectStorage. The worker's `Env` is assignable here.

import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import { newBoardId } from '../shared/board-id';

/** The surface of the Workers Rate Limiting binding used here. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** RPC surface of BoardRoom used for creation (callable on the stub). */
export interface BoardRoomCreateStub {
  initialize(): Promise<'created' | 'exists' | 'error'>;
}

/** The worker bindings createBoard needs (structural; see file header). */
export interface CreateBoardEnv {
  BOARD_ROOM: {
    idFromName(name: string): string;
    get(id: string): BoardRoomCreateStub;
  };
  BOARD_CREATE_LIMITER: Limiter;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Try `maxAttempts` ids: `generate()` yields the candidate, `tryInitialize`
 * resolves to 'created' (taken), 'exists' (collision: try the next) or
 * 'error' (storage failure: stop at once). A throwing `tryInitialize` is an
 * RPC failure, not a collision: fail at once (the caller maps both to 500
 * create_failed).
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists' | 'error'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    let result: 'created' | 'exists' | 'error';
    try {
      result = await tryInitialize(id);
    } catch {
      return { ok: false };
    }
    if (result === 'created') return { ok: true, id };
    if (result === 'error') return { ok: false };
  }
  return { ok: false };
}

/**
 * Create a board for `visitorKey` (the request's CF-Connecting-IP).
 * `generate` is injectable so collision tests can use deterministic ids
 * (design: Mock vs real boundaries); production always uses newBoardId.
 */
export async function createBoard(
  env: CreateBoardEnv,
  visitorKey: string,
  generate: () => string = newBoardId,
): Promise<CreateResult> {
  let allowed = false;
  try {
    const { success } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
    allowed = success;
  } catch {
    allowed = false; // limiter itself failed: fail closed, not rate_limited
  }
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const result = await createWithRetries(generate, (id) => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    return stub.initialize();
  });
  return result.ok ? { ok: true, id: result.id } : { ok: false, reason: 'create_failed' };
}
