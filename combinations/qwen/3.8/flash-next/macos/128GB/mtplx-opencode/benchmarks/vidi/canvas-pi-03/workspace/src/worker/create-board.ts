// Board creation (share.board_api).
//
// Board creation moved SERVER-side in story 5. The two pure pieces that must
// be unit-testable without a Durable Object, a socket or a database live here:
//
//   * createWithRetries — the collision-retry loop (share.unique). It hands
//     each freshly-generated id to `tryInitialize`; a returned `exists` means
//     the code was already in use, so it tries the next one. It stops after
//     `maxAttempts` (default CREATE_ID_MAX_ATTEMPTS) and reports failure — the
//     HTTP layer turns that into a 500.
//   * createBoard — the whole create path: rate limit first, then the retry
//     loop over the Durable Object's `initialize()` RPC.
//
// Ids are `newBoardId()` (16 CSPRNG bytes → 22 base64url chars, 128 bits of
// randomness). They are never derived from time, counters, the creator or
// another board's link (share.unguessable).

import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';
import { newBoardId } from '../shared/board-id';

/** The slice of a Workers rate-limit binding this module uses. A fake with the
 * same `limit({ key })` shape drives the tests where the pinned local runtime
 * does not expose the real binding (documented in the test file). */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Outcome of the whole create attempt. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Generate ids with `generate` and try to claim each with `tryInitialize`, up
 * to `maxAttempts` times. Returns the FIRST id that `tryInitialize` reports as
 * newly `created`. Returns `{ ok: false }` if every attempt collided, or if
 * `tryInitialize` threw. Never calls `tryInitialize` more than `maxAttempts`
 * times (TC-01 / TC-02 boundary).
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generate();
    let result: 'created' | 'exists';
    try {
      result = await tryInitialize(id);
    } catch {
      // A throwing RPC (TC-12) is a create failure, not a crash.
      return { ok: false };
    }
    if (result === 'created') return { ok: true, id };
    // 'exists' → collision, try the next id.
  }
  return { ok: false };
}

/** Env slice createBoard needs (the real Worker Env satisfies it). Declared
 * structurally so the Durable-Object stub's huge generated RPC surface does
 * not have to be instantiated (and so a fake DO can be injected in tests). */
export interface BoardRoomStub {
  initialize(): Promise<'created' | 'exists'>;
}
export interface CreateBoardEnv {
  BOARD_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): BoardRoomStub;
  };
  BOARD_CREATE_LIMITER?: Limiter;
}

/**
 * Create a board for one visitor.
 *
 *   1. Rate limit first (key = the visitor's CF-Connecting-IP). A rejected
 *      visitor gets `rate_limited` and NO board is created (TC-13 / TC-30).
 *   2. Retry-loop a fresh id through the board's Durable Object, which stamps
 *      `created_at` (or reports the code is already taken).
 *
 * `generate` and the RPC are injectable so the tests can force collisions and
 * RPC failures that a real 128-bit generator cannot produce on demand.
 */
export async function createBoard(
  env: CreateBoardEnv,
  visitorKey: string,
  deps: {
    limiter?: Limiter | undefined;
    generate?: () => string;
    initialize?: (id: string) => Promise<'created' | 'exists'>;
  } = {},
): Promise<CreateResult> {
  const limiter = deps.limiter ?? env.BOARD_CREATE_LIMITER;
  if (limiter !== undefined && limiter !== null) {
    const allowed = await limiter.limit({ key: visitorKey });
    if (!allowed.success) return { ok: false, reason: 'rate_limited' };
  }

  const generate = deps.generate ?? newBoardId;
  const initialize =
    deps.initialize ??
    ((id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());

  const created = await createWithRetries(generate, initialize);
  if (!created.ok) return { ok: false, reason: 'create_failed' };
  return { ok: true, id: created.id };
}