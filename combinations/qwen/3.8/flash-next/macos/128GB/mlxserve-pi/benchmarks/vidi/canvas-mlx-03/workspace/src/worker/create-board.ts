// Board creation, server-side (story 5, share.board_api).
//
// A board id is only ever minted here: a visitor key is rate limited, then a
// fresh 128-bit id from `newBoardId()` is offered to that id's BoardRoom over
// Durable Object RPC. An id that already belongs to a board is never handed out
// (share.unique) — the loop mints another one, up to CREATE_ID_MAX_ATTEMPTS
// times, and then the request fails as `create_failed`.
//
// The types here are structural slices of the platform interfaces (the same
// style `board-store.ts` uses) so this module is importable from the plain-node
// unit tests as well as from the Worker.

import { CREATE_ID_MAX_ATTEMPTS } from '../shared/config.ts';
import { newBoardId } from '../shared/board-id.ts';

/** The part of a Rate Limiting API binding this module uses. */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

/** Outcome of `POST /api/boards`. */
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'rate_limited' | 'create_failed' };

/** The RPC surface of a board's Durable Object stub. */
export interface BoardRoomStub {
  /** Migrate + stamp `created_at` when absent; `exists` when the board is there. */
  initialize(): Promise<'created' | 'exists'>;
}

/** The part of `DurableObjectNamespace<BoardRoom>` this module uses. */
export interface BoardRoomNamespaceLike {
  idFromName(id: string): unknown;
  get(id: unknown): BoardRoomStub;
}

/** The bindings `createBoard` needs (a slice of the Worker `Env`). */
export interface CreateEnv {
  BOARD_CREATE_LIMITER: Limiter;
  BOARD_ROOM: BoardRoomNamespaceLike;
  /**
   * TEST SEAM ONLY (integration TC-11): a deterministic id generator, so a real
   * collision with an existing board can be produced. 128-bit ids make real
   * collisions impossible to force otherwise. Production never sets this.
   */
  VIDI_TEST_ID_GENERATOR?: () => string;
}

/**
 * Mint ids and try to initialize them until one is created or the attempts run
 * out. `tryInitialize` returning `'exists'` is a collision: that id is already a
 * board, so a *different* one is generated (share.unique). An exception from
 * `tryInitialize` is a service failure and aborts the loop — the caller turns it
 * into `create_failed`.
 */
export async function createWithRetries(
  generate: () => string,
  tryInitialize: (id: string) => Promise<'created' | 'exists'>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    // A throw from `tryInitialize` is a service failure, not a collision: it
    // propagates so the caller can report 500 rather than minting more ids.
    if ((await tryInitialize(id)) === 'created') return { ok: true, id };
  }
  return { ok: false };
}

/**
 * Create a new empty board for `visitorKey`: rate limit first, then the id /
 * initialize retry loop against that board's Durable Object.
 */
export async function createBoard(env: CreateEnv, visitorKey: string): Promise<CreateResult> {
  const { success } = await env.BOARD_CREATE_LIMITER.limit({ key: visitorKey });
  if (!success) return { ok: false, reason: 'rate_limited' };

  const generate = env.VIDI_TEST_ID_GENERATOR ?? newBoardId;
  const rooms = env.BOARD_ROOM;
  let created: { ok: true; id: string } | { ok: false };
  try {
    created = await createWithRetries(generate, (id) =>
      rooms.get(rooms.idFromName(id)).initialize(),
    );
  } catch (err) {
    // RPC failure (board-room could not be reached or could not write):
    // share.create_failure's 500, with nothing half-created.
    console.error(JSON.stringify({ event: 'board-create-failed', error: String(err) }));
    return { ok: false, reason: 'create_failed' };
  }
  if (!created.ok) return { ok: false, reason: 'create_failed' };
  return { ok: true, id: created.id };
}
