/**
 * Story 5: board creation with rate limiting (share.board_api).
 *
 * `POST /api/boards` logic, split out of `index.ts` so the collision retry
 * loop and the limiter interaction are testable without the fetch layer.
 *
 * This module is Cloudflare-free on purpose (structural env typing instead
 * of importing board-room.ts), so the node-environment unit tests can import
 * it without the `cloudflare:workers` module.
 *
 * The limiter is the Workers `ratelimits` binding (`BOARD_CREATE_LIMITER`)
 * when the runtime materializes it, with an in-memory fallback implementing
 * the same `Limiter` surface for runtimes that don't (e.g. the workerd test
 * pool). The key is the visitor's IP (share.rate_limit).
 */
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../shared/config';
import { newBoardId } from '../shared/board-id';

/**
 * The limiter surface used by board creation: a subset of the Workers
 * `ratelimits` binding's interface, so the in-memory fallback can stand in
 * for the real binding.
 */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The namespace surface createBoard needs from env.BOARD_ROOM. The worker's
 * `DurableObjectNamespace<BoardRoom>` satisfies it structurally.
 */
export interface BoardCreateNamespace {
  idFromName(name: string): string;
  get(id: string): { initialize(): Promise<'created' | 'exists'> };
}

/** The env surface createBoard needs (structural; see above). */
export interface BoardCreateEnv {
  BOARD_ROOM: BoardCreateNamespace;
  /** The Workers `ratelimits` binding (undefined when not materialized). */
  BOARD_CREATE_LIMITER?: Limiter;
}

/** Outcome of a create-board attempt. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/**
 * Test-only overrides for `createBoard` (deterministic generators, failing
 * initialize, injected limiters). Production calls pass none of these.
 */
export interface CreateBoardOverrides {
  generate?: () => string;
  initialize?: (id: string) => Promise<'created' | 'exists'>;
  limiter?: Limiter;
}

/**
 * In-process rate limiter with the same surface as the Workers `ratelimits`
 * binding's simple mode (rolling window per key). Used only where the
 * binding is not materialized; the worker prefers `env.BOARD_CREATE_LIMITER`
 * and falls back to this so every runtime enforces the same limit/period.
 */
export class MemoryLimiter implements Limiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number = BOARD_CREATE_LIMIT,
    private readonly periodMs: number = BOARD_CREATE_PERIOD_SECONDS * 1000,
  ) {}

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    const now = Date.now();
    const windowStart = now - this.periodMs;
    const recent = (this.hits.get(options.key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= this.max) {
      this.hits.set(options.key, recent);
      return { success: false };
    }
    recent.push(now);
    this.hits.set(options.key, recent);
    return { success: true };
  }
}

/** The in-memory fallback limiter (shared per isolate). */
const memoryLimiter: Limiter = new MemoryLimiter();

/**
 * Create-with-retry loop (share.unique): try `tryInitialize` on generated
 * IDs in order; the first `'created'` wins; `'exists'` means the ID was
 * already taken, so draw a fresh one; `maxAttempts` draws without a
 * `'created'` is a failure.
 *
 * Pure: takes `generate` and `tryInitialize` as parameters, so no worker
 * state is needed. A thrown `tryInitialize` propagates to the caller (which
 * maps it to `create_failed`).
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts?: number,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const attempts = maxAttempts ?? CREATE_ID_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const id = generate();
    const state = await tryInitialize(id);
    if (state === 'created') {
      return { ok: true, id };
    }
    // 'exists': the id was already taken — draw a fresh one (share.unique).
  }
  return { ok: false };
}

/**
 * POST /api/boards handler logic: rate limit the visitor, then create-with-
 * retry. Returns `rate_limited` when the limiter denies the visitor and
 * `create_failed` when every candidate ID was taken or initialize threw.
 */
export async function createBoard(
  env: BoardCreateEnv,
  visitorKey: string,
  overrides: CreateBoardOverrides = {},
): Promise<CreateResult> {
  const limiter: Limiter =
    overrides.limiter ?? env.BOARD_CREATE_LIMITER ?? memoryLimiter;
  let allowed: { success: boolean };
  try {
    allowed = await limiter.limit({ key: visitorKey });
  } catch {
    // A limiter error is a service failure, not a rate limit.
    return { ok: false, reason: 'create_failed' };
  }
  if (!allowed.success) {
    return { ok: false, reason: 'rate_limited' };
  }
  const generate = overrides.generate ?? newBoardId;
  const tryInitialize =
    overrides.initialize ??
    ((id: string) =>
      env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id)).initialize());
  let result: { ok: true; id: string } | { ok: false };
  try {
    result = await createWithRetries(generate, tryInitialize, CREATE_ID_MAX_ATTEMPTS);
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
  if (result.ok) {
    return { ok: true, id: result.id };
  }
  return { ok: false, reason: 'create_failed' };
}
