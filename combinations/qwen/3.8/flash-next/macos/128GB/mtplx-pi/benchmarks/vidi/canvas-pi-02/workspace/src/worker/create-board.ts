/**
 * Creating a board, the half that touches the platform (story 5).
 *
 * The decisions — spend the limit before any storage, mint a fresh id per
 * attempt, stop after `CREATE_ID_MAX_ATTEMPTS` — are in
 * `../shared/create-board.ts`, where they can be tested without a Worker. This
 * file is the performing half: it reads the rate-limit binding, gets a stub for
 * the room named by a candidate id, and calls `initialize()` on it.
 *
 * `initialize()` is an RPC to a Durable Object, and it is the only call here. It
 * answers `exists` for an id that is already somebody's, which is how a
 * collision is told apart from a create without a second round trip.
 */
import { createWithRetries, type CreateResult } from '../shared/create-board';
import { newBoardId } from '../shared/board-id';
import type { Env } from './env';

export { createWithRetries, type CreateResult, type InitializeResult, type Limiter } from '../shared/create-board';

/**
 * Create a board for one visitor.
 *
 * There is one way in, and it reads the binding off `env`: a second way to hand
 * a limiter in would be a second way to hand none in, and the tests substitute
 * the whole `env` anyway.
 *
 * The limit is spent *before* an id is minted, so a denied request reads no
 * storage: "the eleventh board in a minute is refused" and "the eleventh board
 * was created and then hidden" have the same answer for the visitor and are not
 * the same thing at all.
 *
 * A limiter that cannot be heard from is a denial, and so is a limiter that is
 * not there at all. The limit is the only thing between an unauthenticated
 * caller and an endless line of persistent boards, so a request that cannot be
 * counted is not a request that got past the counting; a rule that fails open is
 * not a rule. It is reported as a failed create rather than a rate limit, so the
 * page never tells someone to wait a minute when waiting would not help.
 */
export async function createBoard(
  env: Env,
  visitorKey: string,
): Promise<CreateResult> {
  // One way in: the binding comes off `env`, so there is no second path where a
  // limiter is "passed as undefined" and quietly skipped.
  const limiter = env.BOARD_CREATE_LIMITER;
  if (limiter === undefined) return { ok: false, reason: 'create_failed' };

  let allowed: { success: boolean } | undefined;
  try {
    allowed = await limiter.limit({ key: visitorKey });
  } catch {
    return { ok: false, reason: 'rate_limited' };
  }
  if (allowed.success === false) return { ok: false, reason: 'rate_limited' };

  const room = env.BOARD_ROOM;
  const created = await createWithRetries(
    () => newBoardId(),
    async (id) => {
      const stub = room.get(room.idFromName(id));
      const outcome = await stub.initialize();
      return outcome === 'created' ? 'created' : 'exists';
    },
  );

  return created.ok
    ? { ok: true, id: created.id }
    : { ok: false, reason: 'create_failed' };
}
