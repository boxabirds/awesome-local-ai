// Board creation (story 5, share.board_api): generates a 128-bit id and
// initialises the board's Durable Object, retrying on id collision. The
// platform rate limiter (BOARD_CREATE_LIMITER) guards the entry point, so a
// single visitor cannot exhaust storage (PRD share.rate_limit).
//
// This module stays free of `cloudflare:workers` imports: the pure retry
// logic is unit-tested in a plain node environment (TC-01, TC-02), and the
// env type is structural (the production `DurableObjectNamespace<BoardRoom>`
// satisfies it; tests can pass anything else).

import { newBoardId } from '../shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

/** Rate limiter surface used by creation (satisfied by the platform
 *  `RateLimit` binding and by the local stand-in in local-limiter.ts). */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** The BoardRoom RPC surface creation needs. */
export interface BoardRoomStub {
  initialize(): Promise<'created' | 'exists'>;
}

export interface CreateEnv {
  BOARD_ROOM: {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): BoardRoomStub;
  };
  /** Present in production (wrangler.jsonc ratelimits); absent in some
   *  local runtimes, where the caller substitutes a stand-in. */
  BOARD_CREATE_LIMITER?: Limiter;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Tries up to `maxAttempts` fresh ids: `generate` yields the candidate and
 * `tryInitialize` returns 'created' (won) or 'exists' (collision, the DO
 * reported the id is already taken). Never mutates a board that already
 * exists: `initialize` on an existing board returns 'exists' and leaves
 * created_at untouched (TC-11, TC-15).
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    if ((await tryInitialize(id)) === 'created') {
      return { ok: true, id };
    }
  }
  return { ok: false };
}

/* --- Test seams (same-isolate integration tests) ---
 * Deterministic id generator and initialize stand-in for the collision
 * tests (TC-11, TC-12); the real 128-bit generator cannot produce a
 * collision on demand. */
let testGenerate: (() => string) | null = null;
let testInitialize: ((id: string) => Promise<'created' | 'exists'>) | null = null;

export function __testSetIdGenerator(generator: (() => string) | null): void {
  testGenerate = generator;
}

export function __testSetInitialize(initialize: ((id: string) => Promise<'created' | 'exists'>) | null): void {
  testInitialize = initialize;
}

/**
 * Creates a board for `visitorKey`:
 * 1. rate limit (key = visitor's CF-Connecting-IP) — exceeded -> rate_limited;
 * 2. up to CREATE_ID_MAX_ATTEMPTS ids, each initialised via the DO RPC —
 *    a collision returns 'exists' and the loop tries the next id;
 * 3. exhausted attempts or an RPC error -> create_failed (HTTP 500).
 * A rate-limited request creates nothing (the limiter is checked first).
 */
export async function createBoard(env: CreateEnv, visitorKey: string): Promise<CreateResult> {
  const limiter = env.BOARD_CREATE_LIMITER ?? localLimiter;
  const { success } = await limiter.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };

  const generate = testGenerate ?? newBoardId;
  const tryInitialize =
    testInitialize ??
    ((id: string) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());
  let result: { ok: true; id: string } | { ok: false };
  try {
    result = await createWithRetries(generate, tryInitialize);
  } catch {
    // Any infrastructure failure (RPC down, DO storage, ...) is a
    // create_failed, not a crash (share.board_api TC-12).
    return { ok: false, reason: 'create_failed' };
  }
  if (result.ok) return { ok: true, id: result.id };
  return { ok: false, reason: 'create_failed' };
}

/** Local-dev stand-in for the platform binding (fixed window per key,
 *  same limit and period as the named settings). Production always has the
 *  binding, so this is never used there. */
const localLimiter = createLocalLimiter(BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS);

/** In-memory fixed-window counter implementing `Limiter`. */
export function createLocalLimiter(limit: number, periodSeconds: number): Limiter {
  const windows = new Map<string, { count: number; windowStartMs: number }>();
  return {
    async limit({ key }): Promise<{ success: boolean }> {
      const now = Date.now();
      const windowMs = periodSeconds * 1000;
      const current = windows.get(key);
      if (current === undefined || now - current.windowStartMs >= windowMs) {
        windows.set(key, { count: 1, windowStartMs: now });
        return { success: true };
      }
      if (current.count >= limit) return { success: false };
      current.count += 1;
      return { success: true };
    },
  };
}
