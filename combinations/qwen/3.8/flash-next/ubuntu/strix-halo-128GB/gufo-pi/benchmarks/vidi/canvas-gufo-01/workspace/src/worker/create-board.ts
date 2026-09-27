// Board creation service. Two layers:
//  - `createWithRetries`: dependency-injected core, unit-testable (collision
//    retry + RPC failure) with no platform bindings.
//  - `createBoard`: binds the core to the platform rate limiter, the
//    cryptographic id generator and the BoardRoom RPC.

import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

/** Structural stand-in for the DO stub so this module type-checks anywhere. */
export interface BoardRoomStub {
  initialize(): Promise<'created' | 'exists'>;
}

/** Structural stand-in for the bindings `createBoard` needs. */
export interface CreateBoardEnv {
  BOARD_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): BoardRoomStub;
  };
  BOARD_CREATE_LIMITER: Limiter;
}

export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type InitializeResult = 'created' | 'exists';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Generate ids and try to initialise each one. A generator result of 'exists'
 * is an id collision: try again, up to `maxAttempts` total. A throwing
 * `tryInitialize` (platform failure) stops immediately. Returns failure once
 * every attempt collided or the RPC threw.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<InitializeResult>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    const result = await tryInitialize(id); // throws -> caller reports create_failed
    if (result === 'created') return { ok: true, id };
  }
  return { ok: false };
}

/** Visitor key for the rate limiter: client IP, falling back to proxy headers. */
export function visitorKey(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * `generate` is a test seam (design TC-11 injects an id that is already taken);
 * production always calls it without the argument.
 */
export async function createBoard(
  env: CreateBoardEnv,
  key: string,
  generate: () => string = newBoardId,
): Promise<CreateResult> {
  let allowed: boolean;
  try {
    const outcome = await env.BOARD_CREATE_LIMITER.limit({ key });
    allowed = outcome.success;
  } catch (e) {
    // The limiter itself failed: fail closed rather than minting unthrottled boards.
    console.error(JSON.stringify({ event: 'rate-limiter-error', error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, reason: 'rate_limited' };
  }
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const result = await createWithRetries(generate, async (id) => {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    return await stub.initialize();
  });
  if (result.ok) return result;
  return { ok: false, reason: 'create_failed' };
}
