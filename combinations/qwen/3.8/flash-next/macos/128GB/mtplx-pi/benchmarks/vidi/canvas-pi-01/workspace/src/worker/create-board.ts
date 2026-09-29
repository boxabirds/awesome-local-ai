import type { Env, InitOutcome } from './env';

/**
 * Re-exported so callers can build a limiter or a room stub without reaching
 * into `env.ts`; the definitions live there so both files agree.
 */
export type { InitOutcome, Limiter } from './env';
import { newBoardId } from '../shared/board-id';
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config';

/**
 * Story 5 · board creation (design "Board creation and existence API").
 *
 * Board creation moves server-side. A new board's address is generated here
 * from `newBoardId()` (128 random bits, never derived from time, order or any
 * other id — PRD share.unguessable), checked against the per-visitor create
 * limiter, and handed to the board's `BoardRoom` over a Worker-to-Durable-
 * Object RPC call. An id whose storage does not exist yet is created; a
 * collision (the id was somehow already taken) is retried against a fresh id,
 * up to `CREATE_ID_MAX_ATTEMPTS`. A request that never creates a board writes
 * nothing: the existence check and the "not found" path never touch storage.
 */

/**
 * The board the request created, or why it could not. `rate_limited` and
 * `create_failed` map straight onto the HTTP contract (429 / 500).
 */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Try fresh ids until one is created, or the budget runs out. Both the id
 * source and the "is this id taken / create it" step are injected so the
 * collision and RPC-failure paths are testable without a real 128-bit
 * collision (design "Mock vs real boundaries").
 *
 * Returns the created id, or `{ ok: false }` when every attempt reported
 * `exists` or when an attempt threw (an RPC failure is terminal: we do not
 * spin through the remaining budget hammering a broken object).
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<InitOutcome>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generate();
    let outcome: InitOutcome;
    try {
      outcome = await tryInitialize(id);
    } catch {
      return { ok: false };
    }
    if (outcome === 'created') return { ok: true, id };
    // 'exists' → the address was already taken; try the next fresh id.
  }
  return { ok: false };
}

/**
 * Create a board for one visitor. The visitor key is the caller's
 * `CF-Connecting-IP` (design "Contract / Inputs"), which is what the platform
 * rate limiter counts per. Order matters: the limiter is consulted before any
 * id is generated or any object is touched, so a rate-limited burst creates
 * nothing (PRD share.rate_limit).
 */
export async function createBoard(
  env: Env,
  visitorKey: string,
  opts: { maxAttempts?: number; generate?: () => string } = {},
): Promise<CreateResult> {
  const limiter = env.BOARD_CREATE_LIMITER;
  if (limiter !== undefined) {
    const outcome = await limiter.limit({ key: visitorKey });
    if (!outcome.success) return { ok: false, reason: 'rate_limited' };
  }

  const namespace = env.BOARD_ROOM;
  if (namespace === undefined) return { ok: false, reason: 'create_failed' };

  const generate = opts.generate ?? newBoardId;
  const maxAttempts = opts.maxAttempts ?? CREATE_ID_MAX_ATTEMPTS;

  // Each fresh id is handed to the board's Durable Object, which answers
  // 'created' (a new board) or 'exists' (a collision → retry). A thrown RPC is
  // surfaced by `createWithRetries` as a failure, never as a half-made board.
  const tryInitialize = async (id: string): Promise<InitOutcome> => {
    const stub = namespace.get(namespace.idFromName(id));
    return stub.initialize();
  };

  const created = await createWithRetries(generate, tryInitialize, maxAttempts);
  return created.ok ? { ok: true, id: created.id } : { ok: false, reason: 'create_failed' };
}
