// Board creation, kept away from the request router so its two rules - a code
// is never handed out twice, and one visitor cannot make unlimited boards - are
// ordinary functions that can be tested with no workerd in the way.
//
// A board's code is generated here and immediately offered to the board's own
// Durable Object, which answers 'created' or 'exists'. 'exists' means the code
// is already somebody's board: it is never given to the new board (PRD
// share.unique) and the room is never re-initialised; the next code is tried,
// up to CREATE_ID_MAX_ATTEMPTS times, and then the request fails as
// `create_failed` rather than ever reusing a code.
//
// Codes come from `newBoardId()` - 16 random bytes, ~128 bits - and are never
// derived from creation order, time, creator or another board's link (PRD
// share.unguessable).
import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config.ts';
import { newBoardId } from '../shared/board-id.ts';

/** What the board's own room reports about a code. */
export type InitializeResult = 'created' | 'exists';

/**
 * The room RPC this module needs, described structurally rather than by
 * importing the room class: `BoardRoom.initialize()` returns exactly this, and
 * keeping that import out means this file can be read and unit-tested without the
 * worker's globals, and the worker entry can import it without a cycle.
 */
export interface RoomStub {
  initialize(): Promise<InitializeResult>;
}

/**
 * The slice of the board's Durable Object namespace this module uses. `unknown`
 * for the id type is deliberate: the real namespace takes and returns its own
 * opaque id, and this module only ever carries one from `idFromName` to `get`.
 */
export interface RoomNamespace {
  idFromName(id: string): unknown;
  get(id: unknown): RoomStub;
}

/** The slice of the rate-limit binding this module uses. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/** `createBoard` only ever reads these bindings; `Env` is a superset. */
/** What `createBoard` reads out of the worker environment. */
export interface CreateEnv {
  BOARD_ROOM: RoomNamespace;
  BOARD_CREATE_LIMITER: Limiter;
}

/**
 * Injection seams, used by the tests for the two things that cannot be forced
 * on purpose: a collision (real 128-bit codes do not collide on demand) and an
 * RPC that throws. Production calls `createBoard` with two arguments and gets
 * the real generator, the real stub RPC and the real binding.
 */
export interface CreateDeps {
  limiter?: Limiter;
  generate?: () => string;
  initialize?: (id: string) => Promise<InitializeResult>;
}

/**
 * Try codes until one is created, the room refuses to answer, or
 * `maxAttempts` codes have all come back as already taken.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<InitializeResult>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    let result: InitializeResult;
    try {
      result = await tryInitialize(id);
    } catch (err) {
      // The board's room could not be reached or refused the call. Retrying a
      // code that may already be in flight is how a board gets written twice,
      // so this is a failure for THIS request; the visitor can press the button
      // again. (TC-12 asserts the 500.)
      console.error(`[create] could not initialise a board: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false };
    }
    if (result === 'created') return { ok: true, id };
    // 'exists': somebody already owns this code. Nothing was written for it and
    // nothing will be; try another one.
  }
  return { ok: false };
}

/**
 * Create one board for one visitor. The visitor's limit is spent before a code
 * is even generated, so a limited request costs the service nothing.
 */
export async function createBoard(
  env: CreateEnv,
  visitorKey: string,
  deps: CreateDeps = {},
): Promise<CreateResult> {
  const limiter = deps.limiter ?? env.BOARD_CREATE_LIMITER;
  const outcome = await limiter.limit({ key: visitorKey });
  if (!outcome.success) return { ok: false, reason: 'rate_limited' };

  const generate = deps.generate ?? newBoardId;
  const initialize =
    deps.initialize ??
    ((id: string) => {
      // One Durable Object per code: `idFromName` is what maps a code onto its
      // own storage, and `initialize()` is the only thing that writes a board
      // into existence.
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
      return stub.initialize();
    });

  const created = await createWithRetries(generate, initialize);
  return created.ok ? { ok: true, id: created.id } : { ok: false, reason: 'create_failed' };
}

/**
 * The HTTP answer a creation outcome gets, in one place: 201 with the new code,
 * 429 when the visitor has used up the period, 500 when the service could not
 * make a board. A failure never carries a code in its body - there is nothing to
 * hand out - and never answers 200 with an error-shaped body.
 */
export function createResponse(result: CreateResult): Response {
  if (result.ok) return Response.json({ id: result.id }, { status: 201 });
  if (result.reason === 'rate_limited') {
    return Response.json({ error: 'rate_limited' }, { status: 429 });
  }
  return Response.json({ error: 'create_failed' }, { status: 500 });
}

/**
 * The answer for a link that is nobody's board. One body and one status for a
 * malformed code and an uncreated one alike, so checking links cannot learn what
 * a real code looks like.
 */
export function notFoundResponse(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 });
}
